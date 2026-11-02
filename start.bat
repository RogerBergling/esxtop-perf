@echo off
setlocal
cd /d "%~dp0"
python start.py %*
if errorlevel 1 py -3 start.py %*
endlocal
