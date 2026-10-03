@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title FieldCast

:: 1. Check Python prerequisite (3.11+)
set "SYSTEM_PY="
where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
    if not errorlevel 1 set "SYSTEM_PY=python"
)
if not defined SYSTEM_PY (
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
        if not errorlevel 1 set "SYSTEM_PY=py -3"
    )
)

if not exist "%~dp0.venv\Scripts\python.exe" if not defined SYSTEM_PY (
    echo.
    echo [!] Python 3.11+ is required but was not found.
    echo     Please install Python 3.11 or newer from https://www.python.org/
    echo     Ensure "Add Python to PATH" is checked during installation.
    echo.
    pause
    exit /b 1
)
echo    ✓ Python

:: 2. Check / create local virtual environment (.venv)
if not exist "%~dp0.venv\Scripts\python.exe" (
    echo    Creating virtual environment in .venv...
    %SYSTEM_PY% -m venv "%~dp0.venv"
    if errorlevel 1 (
        echo.
        echo [!] Failed to create Python virtual environment in .venv.
        echo.
        pause
        exit /b 1
    )
)
set "VENV_PY=%~dp0.venv\Scripts\python.exe"
echo    ✓ Environment

:: 3. Check / install project dependencies into .venv
"%VENV_PY%" -c "import fastapi, uvicorn, pydantic, httpx, numpy; from backend.app.main import app" >nul 2>&1
if errorlevel 1 (
    echo    Installing dependencies into .venv...
    "%VENV_PY%" -m pip install -q --upgrade pip setuptools wheel >nul 2>&1
    "%VENV_PY%" -m pip install -q -e ".[serve]"
    if errorlevel 1 (
        echo.
        echo [!] Failed to install project dependencies.
        echo.
        pause
        exit /b 1
    )
)
echo    ✓ Dependencies

:: 4. Check model assets
if not exist "%~dp0serve_bundle\mh_ghats" (
    echo.
    echo [!] Required model bundle missing in serve_bundle\.
    echo.
    pause
    exit /b 1
)
echo    ✓ Model

:: 5. Check / build frontend assets
if not exist "%~dp0frontend\dist\index.html" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [!] Node.js and npm are required to build the frontend dashboard.
        echo     Please install Node.js 18+ from https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
    echo    Building frontend dashboard...
    cd "%~dp0frontend"
    if not exist "node_modules" (
        call npm install --silent
    )
    call npm run build
    if errorlevel 1 (
        echo.
        echo [!] Frontend build failed.
        echo.
        pause
        exit /b 1
    )
    cd "%~dp0"
)
echo    ✓ Frontend

echo.
echo Starting...
echo Opening browser...
echo.

start /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8000"

"%VENV_PY%" -m uvicorn backend.app.main:app --port 8000

if errorlevel 1 (
    echo.
    echo [!] Server stopped unexpectedly.
    pause
)

endlocal
