@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Missing] electron is not installed.
  echo Run first: npm install
  echo.
  pause
  exit /b 1
)

set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=pwsh.exe"

echo Installing desktop floating autostart and desktop shortcuts...
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-desktop-shortcuts.ps1"
if errorlevel 1 (
  echo.
  echo Failed to install shortcuts.
  pause
  exit /b 1
)
echo.
echo Done: desktop floating dashboard autostart and desktop shortcut enabled.
pause
