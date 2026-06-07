@echo off
setlocal

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "PYTHON_EXE=%BACKEND%\.venv\Scripts\python.exe"

echo.
echo ==========================================
echo AI Reading Backend Debug
echo ==========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python 3.12 or newer.
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
call "%PYTHON_EXE%" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 (
  echo Failed to install backend dependencies.
  pause
  exit /b 1
)

echo.
echo Starting backend at http://127.0.0.1:8000
echo Errors and EPUB import tracebacks will be shown in this CMD window.
echo.

cd /d "%BACKEND%"
call "%PYTHON_EXE%" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --log-level debug

pause
