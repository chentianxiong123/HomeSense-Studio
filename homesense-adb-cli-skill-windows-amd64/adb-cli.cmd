@echo off
setlocal
set PYTHONIOENCODING=utf-8
set SCRIPT_DIR=%~dp0
python "%SCRIPT_DIR%..\homesense-adb-cli-source\main.py" %*
