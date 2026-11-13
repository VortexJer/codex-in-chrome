#!/usr/bin/env node
// One-shot installer: npm deps, config, Codex skill, MCP registration.
// Usage: node install.mjs [--no-register] [--no-skill]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const mcp = path.join(root, 'server', 'mcp.js').replace(/\/g, '/');

console.log('1/4 Installing server dependencies...');
const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: path.join(root, 'server'), stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) { console.error('npm install failed'); process.exit(1); }

console.log('2/4 Checking config (extension ID <-> hub)...');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config.json'), 'utf8'));
console.log('   extension ID:', cfg.extId, '| hub port:', cfg.port);

if (!args.has('--no-skill')) {
  console.log('3/4 Installing the Codex skill...');
  const dst = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', 'codex-in-chrome');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(root, 'skills', 'codex-in-chrome', 'SKILL.md'), path.join(dst, 'SKILL.md'));
  console.log('   ->', dst);
} else console.log('3/4 Skill skipped.');

if (!args.has('--no-register')) {
  console.log('4/4 Registering the MCP server with Codex...');
  const t = spawnSync('codex', ['mcp', 'add', 'codex-chrome', '--', 'node', mcp], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (t.status !== 0) {
    console.log('   `codex mcp add` unavailable. Add this to ~/.codex/config.toml by hand:\n');
    console.log(`[mcp_servers.codex-chrome]\ncommand = "node"\nargs = ["${mcp}"]\n`);
  }
} else console.log('4/4 Registration skipped.');

console.log(`
Last step (manual, Chrome does not allow doing it for you):
  1. Open chrome://extensions and turn on "Developer mode".
  2. "Load unpacked" -> ${path.join(root, 'extension')}
  3. Click the extension icon / open its side panel and press "Authorize access".
  4. Restart Codex so it loads the new tools.`);
