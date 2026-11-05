@echo off
title Sincronizar Bases desde Google Drive
cd /d "%~dp0"
echo ====================================================
echo  Sincronizando pistas desde tu carpeta de Drive...
echo ====================================================
node sync_drive.js
echo.
set /p subir="Deseas subir los cambios a GitHub para que aparezcan en tu celular? (S/N): "
if /i "%subir%"=="S" (
  git add -A
  git commit -m "Nuevas bases sincronizadas desde Google Drive"
  git push origin main
  echo.
  echo [OK] Pistas subidas a GitHub. Ya estan disponibles en tu celular!
)
pause
