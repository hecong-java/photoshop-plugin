@echo off
setlocal enabledelayedexpansion

echo ====================================
echo   Uninstall NingleAI Photoshop Plugin
echo ====================================
echo.

set "PLUGIN_NAME=ningleai"
set "DELETED=0"

REM Get Photoshop plugin path from registry
set "plugin_folder="
for /f "delims=" %%v in ('reg query "HKLM\SOFTWARE\Adobe\Photoshop" 2^>nul') do (
    echo %%v | findstr /i "^HKEY_" >nul
    if not errorlevel 1 (
        for /f "tokens=2,*" %%H in ('reg query "%%v" /v PluginPath 2^>nul') do (
            set "plugin_folder=%%I"
            goto :got_path
        )
    )
)
:got_path

echo Searching for plugin...
echo.

REM Location 1: UXP External plugins
set "dest1=%APPDATA%\Adobe\UXP\Plugins\External\%PLUGIN_NAME%"
if exist "%dest1%" (
    echo Found: %dest1%
    echo Deleting...
    rd /s /q "%dest1%" 2>nul
    if exist "%dest1%" (
        echo   Failed to delete.
    ) else (
        echo   Deleted successfully.
        set "DELETED=1"
    )
)

REM Location 2: Photoshop Plugins folder
if defined plugin_folder (
    set "dest2=!plugin_folder!%PLUGIN_NAME%"
    if exist "!dest2!" (
        echo Found: !dest2!
        echo Deleting...
        rd /s /q "!dest2!" 2>nul
        if exist "!dest2!" (
            echo   Failed to delete.
        ) else (
            echo   Deleted successfully.
            set "DELETED=1"
        )
    )
)

echo.
if "%DELETED%"=="1" (
    echo ====================================
    echo   Plugin uninstalled successfully!
    echo   Please restart Photoshop.
    echo ====================================
) else (
    echo Plugin not found in any location.
)

echo.
pause
