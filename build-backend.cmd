@echo off
setlocal
cd /d "%~dp0miaoda-go-server"
set "GO=%~dp0.tools\go\bin\go.exe"
if not exist "%GO%" set "GO=%~dp0..\.tools\go\bin\go.exe"
if not exist "%GO%" set "GO=go"
"%GO%" version >nul 2>nul || (echo [ERROR] Go 1.24+ was not found.& exit /b 1)
if not exist bin mkdir bin
"%GO%" mod download || exit /b 1
"%GO%" test ./... || exit /b 1
"%GO%" build -buildvcs=false -trimpath -ldflags="-s -w" -o bin\miaoda-server.exe .\cmd\server
