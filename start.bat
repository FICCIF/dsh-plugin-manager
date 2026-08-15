@echo off
chcp 65001 >nul
title DSH 插件管理器
cd /d "%~dp0"
echo ============================================
echo   正在启动 DSH 插件管理器...
echo   启动后会自动打开浏览器页面
echo   关闭本窗口即停止服务
echo ============================================
echo.
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765"
node server.mjs
echo.
echo 服务已停止。按任意键关闭窗口...
pause >nul
