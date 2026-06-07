@echo off
setlocal

set "ROOT=%~dp0.."
set "FRONTEND=%ROOT%\frontend"

echo.
echo ==========================================
echo AI Reading Frontend
echo ==========================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm was not found. Please install Node.js 20 or newer.
  pause
  exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  cd /d "%FRONTEND%"
  call npm.cmd install
  if errorlevel 1 (
    echo Failed to install frontend dependencies.
    pause
    exit /b 1
  )
)

echo.
echo Starting frontend at http://127.0.0.1:5173
echo.

cd /d "%FRONTEND%"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173

pause
