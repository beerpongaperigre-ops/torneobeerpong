param(
    [string]$Message = "Update Vercel client"
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoDir

function Run-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & git -c http.sslBackend=schannel @Args
    if ($LASTEXITCODE -ne 0) {
        throw "Comando git fallito: git $($Args -join ' ')"
    }
}

Write-Host "== VercelClient deploy ==" -ForegroundColor Cyan
Write-Host "Cartella: $RepoDir"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git non trovato nel PATH. Installa Git oppure apri lo script da un terminale dove git funziona."
}

$insideRepo = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or $insideRepo.Trim() -ne "true") {
    throw "Questa cartella non risulta essere una repo Git."
}

$gitDir = git rev-parse --git-dir
if ((Test-Path (Join-Path $gitDir "rebase-merge")) -or (Test-Path (Join-Path $gitDir "rebase-apply"))) {
    throw "C'e' un rebase Git interrotto. Esegui 'git rebase --continue' oppure 'git rebase --abort' nella cartella VercelClient prima di rilanciare il deploy."
}

<<<<<<< Updated upstream
Write-Host "`nAllineo con GitHub..." -ForegroundColor Cyan
Run-Git pull --rebase --autostash origin main

=======
Write-Host "`nControllo file locali non ancora tracciati..." -ForegroundColor Cyan
Run-Git fetch origin main
$trackedBackups = @()
$untrackedFiles = git ls-files --others --exclude-standard
foreach ($relativePath in $untrackedFiles) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        continue
    }

    git cat-file -e "origin/main:$relativePath" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $localPath = Join-Path $RepoDir $relativePath
        $backupPath = Join-Path $env:TEMP ("vercel-deploy-" + [Guid]::NewGuid().ToString("N") + ".tmp")
        Copy-Item -LiteralPath $localPath -Destination $backupPath -Force
        Remove-Item -LiteralPath $localPath -Force
        $trackedBackups += [pscustomobject]@{ RelativePath = $relativePath; BackupPath = $backupPath }
        Write-Host "Metto da parte ${relativePath}: GitHub lo contiene gia'." -ForegroundColor Yellow
    }
}

Write-Host "`nAllineo con GitHub..." -ForegroundColor Cyan
Run-Git pull --rebase --autostash origin main

foreach ($item in $trackedBackups) {
    $localPath = Join-Path $RepoDir $item.RelativePath
    if (-not (Test-Path -LiteralPath $localPath) -or (Compare-Object (Get-Content -LiteralPath $item.BackupPath -Raw) (Get-Content -LiteralPath $localPath -Raw))) {
        Copy-Item -LiteralPath $item.BackupPath -Destination $localPath -Force
        Write-Host "Ripristino modifica locale: $($item.RelativePath)" -ForegroundColor Yellow
    }
    Remove-Item -LiteralPath $item.BackupPath -Force
}

>>>>>>> Stashed changes
Write-Host "`nStato modifiche:" -ForegroundColor Cyan
git status --short

$changes = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "`nAggiungo i file..." -ForegroundColor Cyan
    Run-Git add .

    $staged = git diff --cached --name-only
    if (-not [string]::IsNullOrWhiteSpace($staged)) {
        Write-Host "`nCreo commit: $Message" -ForegroundColor Cyan
        Run-Git commit -m $Message
    }
}
else {
    Write-Host "`nNessuna modifica locale da committare." -ForegroundColor Yellow
}

Write-Host "`nPush su GitHub..." -ForegroundColor Cyan
Run-Git push origin main

<<<<<<< Updated upstream
Write-Host "`nFatto. Vercel partira' automaticamente dal push GitHub." -ForegroundColor Green
=======
Write-Host "`nFatto. Vercel partira' automaticamente dal push GitHub." -ForegroundColor Green
>>>>>>> Stashed changes
