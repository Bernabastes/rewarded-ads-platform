<#
.SYNOPSIS
  Restores a backup produced by scripts/backup.ps1 (PostgreSQL dump + MinIO bucket mirror).

.DESCRIPTION
  DESTRUCTIVE: replaces the current database contents and (optionally) the bucket contents.
  Stops the API container first so no writes race the restore, then runs `pg_restore --clean --if-exists`,
  re-applies pending Prisma migrations, mirrors media back into MinIO and restarts the API.

    pwsh scripts/restore.ps1 -Backup backups/20260928-120000
    pwsh scripts/restore.ps1 -Backup backups/20260928-120000 -SkipMedia
    pwsh scripts/restore.ps1 -Backup backups/20260928-120000 -Force     # no confirmation prompt

  Drill checklist: docs/RUNBOOK.md "Restore drill".
#>
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [switch]$SkipMedia,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (Test-Path "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin") {
  $env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
}
if (-not (Test-Path (Join-Path $Backup 'db.dump'))) { throw "No db.dump in $Backup" }

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

if (-not $Force) {
  $answer = Read-Host "This REPLACES database '$pgDb'$(if (-not $SkipMedia) { " and bucket '$bucket'" }) with $Backup. Type RESTORE to continue"
  if ($answer -ne 'RESTORE') { Write-Host 'aborted'; exit 1 }
}

Write-Host '[restore] stopping the API so nothing writes during the restore'
docker compose stop api | Out-Null

Write-Host "[restore] pg_restore -> $pgDb"
docker cp (Join-Path $Backup 'db.dump') rap-postgres:/tmp/restore.dump
# terminate other sessions, then restore with --clean so the schema matches the dump exactly
docker exec rap-postgres psql -U $pgUser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$pgDb' AND pid <> pg_backend_pid();" | Out-Null
docker exec rap-postgres pg_restore -U $pgUser -d $pgDb --clean --if-exists --no-owner --no-acl --exit-on-error /tmp/restore.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }
docker exec rap-postgres rm -f /tmp/restore.dump

Write-Host '[restore] applying any migrations newer than the dump'
docker compose run --rm --no-deps --entrypoint sh api -c '/repo/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'

if (-not $SkipMedia -and (Test-Path (Join-Path $Backup 'media'))) {
  Write-Host "[restore] mirroring media -> s3://$bucket"
  $mediaDir = (Resolve-Path (Join-Path $Backup 'media')).Path
  $network = (docker inspect rap-minio --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker run --rm --network $network -v "${mediaDir}:/backup" `
    -e MC_HOST_rap="http://${s3Key}:${s3Secret}@minio:9000" `
    quay.io/minio/mc:latest mirror --overwrite --quiet /backup "rap/$bucket"
  if ($LASTEXITCODE -ne 0) { throw 'mc mirror failed' }
}

Write-Host '[restore] starting the API'
docker compose start api | Out-Null
Start-Sleep -Seconds 8
Write-Host '[restore] verification:'
docker exec rap-postgres psql -U $pgUser -d $pgDb -At -c "SELECT 'users=' || COUNT(*) FROM users UNION ALL SELECT 'ledger=' || COUNT(*) FROM coin_ledger UNION ALL SELECT 'ledger_sum=' || COALESCE(SUM(amount),0) FROM coin_ledger UNION ALL SELECT 'drift_users=' || COUNT(*) FROM users u WHERE u.coin_balance <> (SELECT COALESCE(SUM(amount),0) FROM coin_ledger l WHERE l.user_id = u.id)"
Write-Host '--- expected (from the backup):'
Get-Content (Join-Path $Backup 'db.summary.txt')
try { (Invoke-WebRequest -UseBasicParsing "http://localhost:$(Get-EnvValue 'API_PORT' '3000')/health/ready").Content } catch { Write-Warning "API not ready yet: $($_.Exception.Message)" }
