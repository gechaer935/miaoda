@echo off
setlocal
cd /d "%~dp0miaoda-go-server"
if exist ".env" for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do if not "%%A"=="" if not defined %%A set "%%A=%%B"
set "MIAODA_WLAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0detect-lan-ip.ps1"`) do set "MIAODA_WLAN_IP=%%I"
if defined MIAODA_WLAN_IP (
  set "MOBILE_BASE_URL=http://%MIAODA_WLAN_IP%:5174"
  set "ALLOW_ORIGIN=http://localhost:5173,http://localhost:5174,http://%MIAODA_WLAN_IP%:5174"
  echo [Miaoda] Backend allows phone origin: http://%MIAODA_WLAN_IP%:5174
)
set "GO=%~dp0.tools\go\bin\go.exe"
if not exist "%GO%" set "GO=%~dp0..\.tools\go\bin\go.exe"
if not exist "%GO%" set "GO=go"
"%GO%" version >nul 2>nul || (echo [ERROR] Go 1.24+ was not found. Install Go or place bin\miaoda-server.exe here.& exit /b 1)
if not exist bin mkdir bin
"%GO%" build -buildvcs=false -o bin\miaoda-server.exe .\cmd\server || exit /b 1
bin\miaoda-server.exe
