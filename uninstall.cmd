@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to remove the Codex MCP configuration.
  exit /b 1
)
node "%~dp0scripts\setup.mjs" uninstall %*
exit /b %errorlevel%
