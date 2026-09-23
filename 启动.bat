@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   BRC Nexus v2 - 启动服务器
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未检测到 Node.js！
    echo 请先安装 Node.js: https://nodejs.org/zh-cn/
    echo.
    pause
    exit /b 1
)

REM 检查依赖是否已安装
if not exist "server\node_modules" (
    echo [提示] 首次运行，正在安装服务器依赖...
    cd server
    call npm install
    cd ..
)

if not exist "client\node_modules" (
    echo [提示] 首次运行，正在安装前端依赖...
    cd client
    call npm install
    call npm run build
    cd ..
)

if not exist "client\dist\index.html" (
    echo [提示] 构建前端文件...
    cd client
    call npm run build
    cd ..
)

REM 检查服务器是否已在运行（开机自启可能已启动）
netstat -ano | findstr ":7800" | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [提示] 服务器已经在运行中（端口 7800 已被监听）。
    echo         如需重启，请先关闭旧的 node 窗口或执行: taskkill /F /IM node.exe
    echo.
    start http://localhost:7800
    pause
    exit /b 0
)

echo.
echo [启动] 正在启动服务器...
echo.
echo ========================================
echo   访问地址
echo ========================================
echo   本机:   http://localhost:7800
echo   局域网: http://本机IP:7800
echo.
echo   首次使用会自动进入管理员创建页面
echo   默认账号: admin / admin123
echo ========================================
echo.
echo [提示] 按 Ctrl+C 停止服务器
echo.

cd server
node src\index.js

pause
