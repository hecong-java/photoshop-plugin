@echo off
setlocal
title LemonGrid Installer

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_PATH=%SCRIPT_DIR%install.ps1"

if not exist "%SCRIPT_PATH%" (
  exit /b 1
)

echo Initializing LemonGrid installer...
echo Requesting administrator permission...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process cmd.exe -Verb RunAs -Wait -PassThru -ArgumentList '/c title LemonGrid Installer && powershell -NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT_PATH%""'; exit $p.ExitCode"
if errorlevel 1 (
  exit /b 1
)
exit /b 0
