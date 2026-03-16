@echo off
setlocal
for /f "delims=" %%v in ('reg query "HKLM\SOFTWARE\Adobe\Photoshop"') do (
  echo %%v | findstr /i "^HKEY_" >nul
  if not errorlevel 1 (
    for /f "tokens=2,*" %%H in ('reg query "%%v" /v PluginPath') do (
      set "plugin_folder=%%I"
      goto :break_all
    )
  )
)
:break_all
echo ps_plugin_install_path: %plugin_folder%
set "source_folder=ningleai"
set "destination_folder=C:\Users\%USERNAME%\AppData\Roaming\Adobe\UXP\Plugins\External\%source_folder%"
set "destination_folder2=%plugin_folder%%source_folder%"
if not exist "%destination_folder%" (
    md "%destination_folder%" || (
        echo Failed to create destination folder.
        exit /b
    )
)
if not exist "%destination_folder2%" (
    md "%destination_folder2%" || (
        echo Failed to create destination folder.
        exit /b
    )
)
taskkill /f /im explorer.exe /fi "PID eq explorer.exe" /fi "CWD eq %destination_folder%"
xcopy "%source_folder%" "%destination_folder%" /E /S /C /H /Y || (
    echo Copy failed.
    exit /b
)
xcopy "%source_folder%" "%destination_folder2%" /E /S /C /H /Y || (
    echo Copy failed.
    exit /b
)
dir "%destination_folder%" /B /AD > nul 2>&1 && (
     explorer.exe "%destination_folder%"
)
dir "%destination_folder2%" /B /AD > nul 2>&1 && (
     explorer.exe "%destination_folder2%"
)
endlocal
pause
