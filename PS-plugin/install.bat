@echo off
setlocal

:: Ensure running from the script's own directory
cd /d "%~dp0"

:: Validate source folder exists
if not exist "lemongrid" (
    echo [ERROR] Cannot find 'lemongrid' folder. Please run install.bat from the PS-plugin directory.
    pause
    exit /b 1
)

:: Find the latest PS version with PluginPath
set "plugin_folder="
for /f "delims=" %%v in ('reg query "HKLM\SOFTWARE\Adobe\Photoshop" 2^>nul') do (
  echo %%v | findstr /i "^HKEY_" >nul
  if not errorlevel 1 (
    for /f "tokens=2,*" %%H in ('reg query "%%v" /v PluginPath 2^>nul') do (
      set "plugin_folder=%%I"
    )
  )
)
:: The loop now processes ALL subkeys — last valid PluginPath wins (highest version)

echo ps_plugin_install_path: %plugin_folder%

set "source_folder=lemongrid"
set "destination_folder=C:\Users\%USERNAME%\AppData\Roaming\Adobe\UXP\Plugins\External\%source_folder%"
set "destination_folder2=%plugin_folder%%source_folder%"

:: UXP ExternalPlugins path
if not exist "%destination_folder%" (
    md "%destination_folder%" || (
        echo Failed to create UXP plugin folder.
        pause
        exit /b 1
    )
)

:: Traditional Plug-Ins path (if PluginPath was found)
if not "%plugin_folder%"=="" (
    if not exist "%destination_folder2%" (
        md "%destination_folder2%" || (
            echo Failed to create Plug-Ins folder.
            pause
            exit /b 1
        )
    )
)

taskkill /f /im explorer.exe /fi "PID eq explorer.exe" /fi "CWD eq %destination_folder%"
xcopy "%source_folder%" "%destination_folder%" /E /S /C /H /Y || (
    echo Copy to UXP folder failed.
    pause
    exit /b 1
)

if not "%plugin_folder%"=="" (
    xcopy "%source_folder%" "%destination_folder2%" /E /S /C /H /Y || (
        echo Copy to Plug-Ins folder failed.
        pause
        exit /b 1
    )
)

echo.
echo Installation complete!
echo Please restart Photoshop to see the LemonGrid plugin.
echo.

dir "%destination_folder%" /B /AD > nul 2>&1 && (
     explorer.exe "%destination_folder%"
)
if not "%plugin_folder%"=="" (
    dir "%destination_folder2%" /B /AD > nul 2>&1 && (
        explorer.exe "%destination_folder2%"
    )
)

endlocal
pause
