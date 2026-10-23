@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Installing login autostart shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $startup=[Environment]::GetFolderPath('Startup'); $lnk=$ws.CreateShortcut((Join-Path $startup 'AIUsageDashboard.lnk')); $lnk.TargetPath='wscript.exe'; $lnk.Arguments='\"%~dp0run-hidden.vbs\"'; $lnk.WorkingDirectory='%~dp0'; $lnk.Save()"
echo.
echo Installed: AIUsageDashboard.lnk
echo Starting once in the background...
start "" wscript.exe "%~dp0run-hidden.vbs"
echo.
echo Open http://127.0.0.1:8787 on this computer.
echo For phone access, configure HOST and PAIRING_KEY in config.json first. See README.md.
pause
