<#
.SYNOPSIS
  One-command local demo: checks Docker, starts infrastructure, applies migrations, seeds demo data,
  starts the API (in the foreground unless -NoApi) and prints every URL and credential you need.

.EXAMPLE
  pnpm demo                       # infra + migrate + seed + API in this window
  pnpm demo -- -SkipSeed          # keep existing data
  pnpm demo -- -NoApi             # only prepare infra/data (e.g. before `pnpm dev`)
  pnpm demo -- -Containers        # run the API + both web portals from docker compose instead of pnpm
#>
param(
  [switch]$SkipSeed,
  [switch]$NoApi,
  [switch]$Containers
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Section([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok([string]$msg) { Write-Host "   $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

# Docker Desktop keeps its CLI plugins/credential helper next to the executable on Windows.
$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
if (Test-Path $dockerBin) { $env:PATH = "$dockerBin;$env:PATH" }

Section 'Docker'
$engine = docker info 2>&1 | Select-String -Pattern 'Server Version'
if (-not $engine) {
  $exe = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
  if (-not (Test-Path $exe)) { $exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe' }
  if (Test-Path $exe) {
    Write-Host '   engine not running - starting Docker Desktop...'
    Start-Process $exe
    $deadline = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $deadline -and -not $engine) {
      Start-Sleep 10
      $engine = docker info 2>&1 | Select-String -Pattern 'Server Version'
    }
  }
}
if (-not $engine) { Fail 'Docker engine is not reachable. Start Docker Desktop and retry.' }
Ok "engine: $($engine.ToString().Trim())"

Section '.env'
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Ok 'created .env from .env.example (edit POSTGRES_PORT / DATABASE_URL if 5432 is taken)'
} else { Ok '.env present' }

Section 'Infrastructure (postgres, redis, minio)'
docker compose up -d postgres redis minio minio-init 2>&1 | Select-String -Pattern 'Started|Healthy|Running|Error' | ForEach-Object { "   $_" }
$deadline = (Get-Date).AddMinutes(2)
do {
  Start-Sleep 3
  $healthy = (docker compose ps --format '{{.Name}} {{.Health}}' 2>$null | Select-String -Pattern 'rap-(postgres|redis|minio) healthy').Count
} while ($healthy -lt 3 -and (Get-Date) -lt $deadline)
if ($healthy -lt 3) { Fail 'infrastructure containers did not become healthy' }
Ok 'postgres, redis, minio healthy'

Section 'Database'
node apps/api/scripts/with-env.cjs prisma migrate deploy --schema apps/api/prisma/schema.prisma 2>&1 | Select-String -Pattern 'migration|No pending|applied|Error' | ForEach-Object { "   $_" }
if (-not $SkipSeed) {
  Write-Host '   seeding demo data (resets existing data)...'
  Push-Location apps/api
  node scripts/with-env.cjs ts-node --transpile-only prisma/seed.ts 2>&1 | Select-String -Pattern 'Seed complete|Uploaded|Error|error' | ForEach-Object { "   $_" }
  Pop-Location
}

$env = Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; @{ k = $k.Trim(); v = ($v -replace '\s+#.*$', '').Trim() } }
$apiUrl = ($env | Where-Object { $_.k -eq 'API_PUBLIC_URL' } | Select-Object -First 1).v
if (-not $apiUrl) { $apiUrl = 'http://localhost:3000' }

Section 'URLs'
@"
   API / Swagger      $apiUrl/api/docs        (health: $apiUrl/health/ready)
   Advertiser portal  http://localhost:5173    (pnpm dev:advertiser  or docker compose service advertiser-web)
   Admin dashboard    http://localhost:5174    (pnpm dev:admin       or docker compose service admin-web)
   Mobile app (web)   http://localhost:8081    (pnpm dev:mobile -> Expo web; scan the QR for a device)
   MinIO console      http://localhost:9001    (minioadmin / minioadmin)
"@ | Write-Host

Section 'Demo credentials'
@"
   Admins (password Admin123!):      super@rap.et (super_admin) | reviewer@rap.et (ad_reviewer)
                                     support@rap.et (support)    | finance@rap.et, finance2@rap.et (finance)
   Advertisers (Advertiser123!):     ads@habesha-coffee.et, growth@addisfintech.et (verified)
                                     hello@shegerfashion.et (pending verification)
   Users (phone + OTP):              +251911000000, +251911000137, +251911000274 ... any new Ethiopian number
                                     OTP is returned as devCode (OTP_DEV_ECHO=true) and 123456 always works (OTP_DEV_FIXED_CODE)
"@ | Write-Host

if ($Containers) {
  Section 'Full stack in containers'
  docker compose up -d --build 2>&1 | Select-String -Pattern 'Started|Built|Error' | ForEach-Object { "   $_" }
  Ok 'api :3000, advertiser-web :5173, admin-web :5174'
  exit 0
}

if ($NoApi) { Ok 'infra + data ready. Start the apps with: pnpm dev  (API + both portals) and pnpm dev:mobile'; exit 0 }

Section 'API (Ctrl+C to stop)'
Write-Host '   starting NestJS in watch mode... then run `pnpm dev:advertiser`, `pnpm dev:admin`, `pnpm dev:mobile` in other terminals'
node scripts/run-workspace.mjs dev --filter @rap/api
