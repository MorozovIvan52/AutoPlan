@echo off
chcp 65001 >nul
echo Closing Cursor and repairing Agent...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-cursor-agent.ps1"
echo.
pause
