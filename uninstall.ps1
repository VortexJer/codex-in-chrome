$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required to remove the Codex MCP configuration.' }
& node (Join-Path $PSScriptRoot 'scripts/setup.mjs') uninstall @args
exit $LASTEXITCODE
