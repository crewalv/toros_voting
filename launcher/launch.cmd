@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js ne nayden. Ustanovite Node.js 22.12+ i zapustite snova.
  pause
  exit /b 1
)
node launcher\start-local.cjs
pause
