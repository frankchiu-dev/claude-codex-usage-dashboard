@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting Claude / Codex usage dashboard...
echo.
rem Optional settings:
rem set PORT=8787
rem Default: local only. To share with paired devices on Wi-Fi, pass --lan.
rem set ALERT_PERCENT=85
rem set DISPLAY_MODE=used
rem set CODEX_LOOKBACK_DAYS=14
node server.js %*
echo.
echo Dashboard stopped. If you saw an error above, make sure Node.js is installed and available in PATH.
pause
