@echo off
echo Starting HomeSense Backend and Frontend...
start "Backend" cmd /c "cd /d "%~dp0agent" && npm run dev"
start "Frontend" cmd /c "cd /d "%~dp0homesense-frontend" && npm run dev"
echo Backend: http://localhost:3000
echo Frontend: http://localhost:9527
pause
