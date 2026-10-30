@echo off
title Freestyle Rap Studio
cd /d "%~dp0"
echo Iniciando Freestyle Rap Studio...
start http://localhost:3000
node server.js
pause

