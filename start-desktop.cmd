@echo off
setlocal
cd /d "%~dp0miaoda-desktop"
rem This is the local development launcher. Packaged builds still default to
rem https://api.example.invalid inside MiaodaAuthClient.
if not defined MIAODA_API_BASE_URL set "MIAODA_API_BASE_URL=http://127.0.0.1:3001"
if not exist node_modules npm.cmd ci || exit /b 1
if not exist node_modules\electron\dist\electron.exe node.exe node_modules\electron\install.js || exit /b 1
npm.cmd run app:dev
