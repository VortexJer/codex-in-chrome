@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org/
  exit /b 1
)
node "%~dp0scripts\setup.mjs" install %*
set "setup_result=%errorlevel%"
if not "%setup_result%"=="0" echo Installation failed. See the error above.
exit /b %setup_result%
