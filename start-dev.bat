@echo off
title LemonGrid PS 插件 - 本地开发服务
cd /d "%~dp0code\webapp"

where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 没找到 npm，请先安装 Node.js
    pause
    exit /b 1
)

if not exist node_modules (
    echo 首次运行，先安装依赖（可能需要几分钟）...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

echo.
echo ============================================
echo   本地开发服务启动中
echo   页面地址: http://localhost:5173/ps/
echo.
echo   插件壳指向请用 switch-url.bat 切换/查看
echo   关闭本窗口即停止服务
echo ============================================
echo.
call npm run dev
pause
