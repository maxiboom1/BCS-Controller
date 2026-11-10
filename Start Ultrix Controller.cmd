@echo off
setlocal
cd /d "%~dp0" || exit /b 1
title Ultrix Controller

set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"
"%NODE_EXE%" -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 is required. Install it or place node.exe in the runtime folder.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Build the app with pnpm build before starting it.
  pause
  exit /b 1
)

set "BCS_MODE=live"
if not defined BCS_HOST set "BCS_HOST=10.10.10.156"
if not defined BCS_PORT set "BCS_PORT=12345"
if not defined BCS_DATA_DIR set "BCS_DATA_DIR=%~dp0data\live"
set "BCS_ENABLE_SELECTED_LEVELS=no"
set "WEB_HOST=127.0.0.1"
set "WEB_ORIGIN="
set "WEB_ALLOW_LOCAL_HTTP=yes"
set "WEB_TLS_CERT="
set "WEB_TLS_KEY="

echo Ultrix Controller - Press Ctrl+C to stop.
echo.
"%NODE_EXE%" server\index.ts
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
