@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-vercel.ps1" %*
if errorlevel 1 (
  echo.
  echo ERRORE durante deploy-vercel.ps1
  pause
  exit /b 1
)
echo.
pause