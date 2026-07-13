param(
    [string]$Message = "Update Vercel client"
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoDir

Write-Host "== VercelClient deploy ==" -ForegroundColor Cyan
Write-Host "Cartella: $RepoDir"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git non trovato nel PATH. Installa Git oppure apri lo script da un terminale dove git funziona."
}

$insideRepo = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or $insideRepo.Trim() -ne "true") {
    throw "Questa cartella non risulta essere una repo Git."
}

Write-Host "`nStato modifiche:" -ForegroundColor Cyan
git status --short

$changes = git status --porcelain
if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "`nNessuna modifica da pubblicare." -ForegroundColor Yellow
    exit 0
}

Write-Host "`nAggiungo i file..." -ForegroundColor Cyan
git add .

$staged = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace($staged)) {
    Write-Host "Nessuna modifica staged." -ForegroundColor Yellow
    exit 0
}

Write-Host "`nCreo commit: $Message" -ForegroundColor Cyan
git commit -m $Message

Write-Host "`nPush su GitHub..." -ForegroundColor Cyan
git push

Write-Host "`nFatto. Vercel partirà automaticamente dal push GitHub." -ForegroundColor Green