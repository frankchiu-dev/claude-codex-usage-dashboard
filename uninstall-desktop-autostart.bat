@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=pwsh.exe"

"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-desktop-shortcuts.ps1" -Uninstall
if errorlevel 1 (
  echo.
  echo Failed to remove shortcuts.
  pause
  exit /b 1
)
echo.
echo Removed desktop dashboard shortcuts.
pause
