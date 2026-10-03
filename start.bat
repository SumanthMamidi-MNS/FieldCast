@echo off
setlocal

:: FieldCast one-click launcher
:: Double-click this file to start the app and open it in your browser.

cd /d "%~dp0"
title FieldCast

:: Locate the Python interpreter (prefer project virtualenv)
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
    where python >nul 2>&1
    if not errorlevel 1 (
        python -c "import uvicorn, fastapi, backend.app.main" >nul 2>&1
        if not errorlevel 1 (
            set "PY=python"
        )
    )
)

if not exist "%PY%" if not "%PY%"=="python" (
    echo [FieldCast] ERROR: Python environment not found.
    echo Please complete setup first:
    echo   python -m venv .venv
    echo   .venv\Scripts\python -m pip install -e ".[serve,pipeline,dev]"
    echo   cd frontend ^&^& npm install ^&^& npm run build
    echo.
    pause
    exit /b 1
)

:: Build the frontend if missing
if not exist "%~dp0frontend\dist\index.html" (
    echo [FieldCast] Building frontend dashboard...
    cd "%~dp0frontend"
    if not exist "%~dp0frontend\node_modules" (
        call npm install
    )
    call npm run build
    if errorlevel 1 (
        echo [FieldCast] ERROR: Frontend build failed.
        pause
        exit /b 1
    )
    cd "%~dp0"
)

:: Automatically open the application in the user's default browser
echo [FieldCast] Starting FieldCast on http://localhost:8000 ...
start /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8000"

:: Start the application server
"%PY%" -m uvicorn backend.app.main:app --port 8000

if errorlevel 1 (
    echo.
    echo [FieldCast] Server stopped or exited with an error.
    pause
)

endlocal
