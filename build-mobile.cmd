@echo off
setlocal
cd /d "%~dp0miaoda-mobile-web"
set "PNPM=pnpm"
"%PNPM%" install || exit /b 1
"%PNPM%" build
