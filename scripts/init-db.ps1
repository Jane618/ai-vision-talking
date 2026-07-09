<#
.SYNOPSIS
    Initialize AI Talking PostgreSQL database.
#>

$ErrorActionPreference = "Continue"
$DbName = "ai_talking"
$DbUser = "postgres"
$DbPass = "postgres"
$ScriptPath = Join-Path $PSScriptRoot "..\backend-python\scripts\init_db.sql"
$ScriptPath = Resolve-Path $ScriptPath

Write-Host "[1/3] Creating database $DbName ..." -ForegroundColor Cyan
$env:PGPASSWORD = $DbPass
psql -h localhost -U $DbUser -c "CREATE DATABASE $DbName;" 2>$null

Write-Host "[2/3] Running init_db.sql ..." -ForegroundColor Cyan
psql -h localhost -U $DbUser -d $DbName -f $ScriptPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to initialize tables. Check PostgreSQL connection." -ForegroundColor Red
    pause
    exit 1
}

Write-Host "[3/3] Done. Database $DbName is ready." -ForegroundColor Green
pause