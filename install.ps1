$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20 or newer is required. Download it from https://nodejs.org/' }
& node (Join-Path $PSScriptRoot 'scripts/setup.mjs') install @args
exit $LASTEXITCODE
