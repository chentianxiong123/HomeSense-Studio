@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
  echo Using virtual environment: .venv\Scripts\python.exe
  ".venv\Scripts\python.exe" -c "import fastapi" >nul 2>nul
  if errorlevel 1 (
    echo Installing requirements into virtual environment...
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  )
  ".venv\Scripts\python.exe" main.py
) else (
  echo Virtual environment not found, using system python
  python -c "import fastapi" >nul 2>nul
  if errorlevel 1 (
    echo Installing requirements into system python...
    python -m pip install -r requirements.txt
  )
  python main.py
)

echo.
echo Intent service exited.
pause
