@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-miaoda.ps1"
if errorlevel 1 (
  echo [ERROR] Failed to stop old Miaoda processes.
  exit /b 1
)
timeout /t 1 /nobreak >nul
set "MIAODA_WLAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0detect-lan-ip.ps1"`) do set "MIAODA_WLAN_IP=%%I"
if defined MIAODA_WLAN_IP (
  set "MOBILE_BASE_URL=http://%MIAODA_WLAN_IP%:5174"
  set "ALLOW_ORIGIN=http://localhost:5173,http://localhost:5174,http://%MIAODA_WLAN_IP%:5174"
  echo [Miaoda] Phone URL: http://%MIAODA_WLAN_IP%:5174
) else (
  echo [Miaoda] WLAN IP was not detected; using values from miaoda-go-server\.env
)
start "Miaoda Go Backend" cmd /k call "%~dp0start-backend.cmd"
timeout /t 4 /nobreak >nul
start "Miaoda Mobile Web" cmd /k call "%~dp0start-mobile.cmd"
set "MIAODA_API_BASE_URL=http://127.0.0.1:3001"
start "Miaoda Desktop" cmd /k call "%~dp0start-desktop.cmd"
