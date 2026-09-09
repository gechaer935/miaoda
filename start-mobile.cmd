@echo off
setlocal
cd /d "%~dp0miaoda-mobile-web"
set "PNPM=pnpm"
if not exist node_modules "%PNPM%" install || exit /b 1
"%PNPM%" dev
