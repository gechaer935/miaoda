@echo off
setlocal
cd /d "%~dp0miaoda-desktop"
if not exist node_modules call npm.cmd ci || exit /b 1
call npm.cmd run build || exit /b 1
call npm.cmd run typecheck:electron || exit /b 1
call npm.cmd run build:electron || exit /b 1
call node_modules\.bin\electron-builder.cmd --win nsis --x64 || exit /b 1
call node scripts\prepare-windows-update-feed.mjs || exit /b 1
