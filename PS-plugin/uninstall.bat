@echo off
chcp 65001 >nul
echo ====================================
echo   柠乐AI Photoshop 插件卸载脚本
echo ====================================
echo.

set "PLUGIN_NAME=ningleai"
set "PLUGIN_DIR=%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\Internal\%PLUGIN_NAME%"

echo 正在查找插件...
if exist "%PLUGIN_DIR%" (
    echo 找到插件目录: %PLUGIN_DIR%
    echo.
    echo 正在删除插件文件...
    rd /s /q "%PLUGIN_DIR%"
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo ✓ 插件已成功卸载！
        echo.
        echo 请重启 Photoshop 以完成卸载。
    ) else (
        echo.
        echo ✗ 卸载失败，请尝试手动删除以下目录：
        echo   %PLUGIN_DIR%
    )
) else (
    echo 未找到已安装的插件。
    echo.
    echo 如果插件安装在其他位置，请手动删除。
)

echo.
echo ====================================
pause
