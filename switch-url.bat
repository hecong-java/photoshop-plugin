@echo off
setlocal
cd /d "%~dp0"

set "HTML=PS-plugin\lemongrid\index.html"
set "PROD_URL=https://lemongrid.cn/ps/"
set "DEV_URL=http://localhost:5173/ps/"

if /i "%~1"=="dev"    goto set_dev
if /i "%~1"=="prod"   goto set_prod
if /i "%~1"=="status" goto status
if /i "%~1"==""       goto status
echo 用法: switch-url.bat [dev^|prod^|status]
goto done

:set_dev
call :apply dev
if errorlevel 1 (echo [失败] 切换失败，请手动检查 %HTML%) else (echo [OK] 已切到本地开发地址: %DEV_URL%)
goto done

:set_prod
call :apply prod
if errorlevel 1 (echo [失败] 切换失败，请手动检查 %HTML%) else (echo [OK] 已切回线上发布地址: %PROD_URL%)
goto done

:apply
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\switch-url.ps1" -Mode %1
exit /b %errorlevel%

:status
findstr /R /C:"src=.http" "%HTML%"
findstr /C:"%DEV_URL%" "%HTML%" >nul && (
    echo 当前指向: 本地开发地址 ^(调试模式^)
    goto done
)
findstr /C:"%PROD_URL%" "%HTML%" >nul && (
    echo 当前指向: 线上发布地址
    goto done
)
echo 当前指向: 未知地址！不要手动改，请执行 switch-url.bat prod 恢复

:done
echo.
pause
