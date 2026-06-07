@echo off
setlocal

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "PYTHON_EXE=%BACKEND%\.venv\Scripts\python.exe"

echo.
echo ==========================================
echo AI Reading - Phase 1-2
echo Text import, segmentation, role detection
echo ==========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python 3.12 or newer.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm was not found. Please install Node.js 20 or newer.
  pause
  exit /b 1
)

if not exist "%PYTHON_EXE%" (
  echo Creating backend virtual environment...
  python -m venv "%BACKEND%\.venv"
  if errorlevel 1 (
    echo Failed to create backend virtual environment.
    pause
    exit /b 1
  )
)

echo Installing backend dependencies...
"%PYTHON_EXE%" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 (
  echo Failed to install backend dependencies.
  pause
  exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND%"
  call npm.cmd install
  popd
  if errorlevel 1 (
    echo Failed to install frontend dependencies.
    pause
    exit /b 1
  )
)

echo.
echo Starting backend at http://127.0.0.1:8000
echo Backend errors and EPUB import tracebacks will be shown in the "AI Reading Backend" CMD window.
start "AI Reading Backend" "%~dp0start_backend_debug.bat"

echo Starting frontend at http://127.0.0.1:5173
start "AI Reading Frontend" "%~dp0start_frontend_dev.bat"

echo.
echo Open this URL in your browser:
echo http://127.0.0.1:5173
echo.
echo Keep the two opened command windows running while using the app.
echo If EPUB import fails, check the "AI Reading Backend" CMD window first.
pause
