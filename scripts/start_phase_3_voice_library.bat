@echo off
setlocal

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "PYTHON_EXE=%BACKEND%\.venv\Scripts\python.exe"

echo.
echo ==========================================
echo AI Reading - Phase 3
echo Voice library and voice assignment
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
start "AI Reading Backend" "%~dp0start_backend_debug.bat"

echo Starting frontend at http://127.0.0.1:5173/phase3.html
start "AI Reading Phase 3 Frontend" "%~dp0start_frontend_phase3_dev.bat"

echo.
echo Opening Phase 3 page in your browser:
echo http://127.0.0.1:5173/phase3.html
echo.
echo Phase 3 imports the full JSON exported by Phase 1-2 and exports a new phase3 JSON.
pause
