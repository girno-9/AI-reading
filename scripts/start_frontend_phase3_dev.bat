@echo off
setlocal

set "ROOT=%~dp0.."
set "FRONTEND=%ROOT%\frontend"
set "LOG_FILE=%TEMP%\ai_reading_phase3_vite.log"

echo.
echo ==========================================
echo AI Reading Frontend - Phase 3
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
echo VITE dev server for Phase 3
echo.
echo   Local:   http://127.0.0.1:5173/phase3.html
echo.
echo Keep this window open while using Phase 3.
echo Vite logs are written to:
echo   %LOG_FILE%
echo.

cd /d "%FRONTEND%"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --open /phase3.html > "%LOG_FILE%" 2>&1

echo.
echo Frontend server stopped. Last Vite log:
type "%LOG_FILE%"
pause
