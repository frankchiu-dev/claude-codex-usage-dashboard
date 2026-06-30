@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo [Missing] npm dependencies not installed. Run:
  echo   npm install
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Missing] electron is not installed.
  echo Install dependencies first: npm install
  echo.
  pause
  exit /b 1
)

echo Starting Claude / Codex usage dashboard in floating desktop window...
set "DASHBOARD_HOST=127.0.0.1"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0desktop\main.js"
