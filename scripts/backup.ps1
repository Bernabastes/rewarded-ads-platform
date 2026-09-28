<#
.SYNOPSIS
  Backs up the Rewarded Ads Platform: PostgreSQL (pg_dump via the compose container) + MinIO bucket mirror.

.DESCRIPTION
  Writes backups/<timestamp>/db.dump (pg_dump custom format, compressed) and backups/<timestamp>/media/ (mirror of the
  S3 bucket via the `minio/mc` client run as a container on the compose network). Reads credentials from .env.
  Keeps the newest -Keep backups (default 14). Run from the repository root:

    pwsh scripts/backup.ps1                # full backup
    pwsh scripts/backup.ps1 -SkipMedia     # database only
    pwsh scripts/backup.ps1 -Keep 30

  Restore drill: see docs/RUNBOOK.md and scripts/restore.ps1.
#>
param(
  [string]$OutDir = 'backups',
  [switch]$SkipMedia,
  [int]$Keep = 14
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (Test-Path "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin") {
  $env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
}

function Get-EnvValue([string]$name, [string]$default) {
  if (Test-Path .env) {
    $line = Get-Content .env | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].Trim() -replace '\s+#.*$', '' }
  }
  return $default
}
$pgUser = Get-EnvValue 'POSTGRES_USER' 'rap'
$pgDb = Get-EnvValue 'POSTGRES_DB' 'rap'
$s3Key = Get-EnvValue 'S3_ACCESS_KEY' 'minioadmin'
$s3Secret = Get-EnvValue 'S3_SECRET_KEY' 'minioadmin'
$bucket = Get-EnvValue 'S3_BUCKET' 'rap-media'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $OutDir $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "[backup] pg_dump $pgDb -> $dest\db.dump"
docker exec rap-postgres pg_dump -U $pgUser -d $pgDb -Fc --no-owner --no-acl -f /tmp/db.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp rap-postgres:/tmp/db.dump (Join-Path $dest 'db.dump')
docker exec rap-postgres rm -f /tmp/db.dump
docker exec rap-postgres psql -U $pgUser -d $pgDb -At -c "SELECT 'users=' || COUNT(*) FROM users UNION ALL SELECT 'ledger=' || COUNT(*) FROM coin_ledger UNION ALL SELECT 'ledger_sum=' || COALESCE(SUM(amount),0) FROM coin_ledger" |
  Out-File -Encoding utf8 (Join-Path $dest 'db.summary.txt')

if (-not $SkipMedia) {
  Write-Host "[backup] mirroring s3://$bucket -> $dest\media"
  $mediaDir = (Resolve-Path $dest).Path + '\media'
  New-Item -ItemType Directory -Force -Path $mediaDir | Out-Null
  $network = (docker inspect rap-minio --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker run --rm --network $network -v "${mediaDir}:/backup" `
    -e MC_HOST_rap="http://${s3Key}:${s3Secret}@minio:9000" `
    quay.io/minio/mc:latest mirror --overwrite --quiet "rap/$bucket" /backup
  if ($LASTEXITCODE -ne 0) { throw 'mc mirror failed' }
}

@{
  createdAt = (Get-Date).ToString('o')
  database = $pgDb
  bucket = $bucket
  media = -not $SkipMedia
  gitCommit = (git rev-parse --short HEAD 2>$null)
} | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $dest 'manifest.json')

# retention
Get-ChildItem $OutDir -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object {
  Write-Host "[backup] pruning $($_.FullName)"
  Remove-Item -Recurse -Force $_.FullName
}
Write-Host "[backup] done: $dest"
Get-Content (Join-Path $dest 'db.summary.txt')
