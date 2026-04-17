@echo off
setlocal
call "%~dp0adb-cli.cmd" run "{\"action\":\"list_devices\"}"
