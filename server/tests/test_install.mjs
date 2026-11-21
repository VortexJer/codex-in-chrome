// Run the real installer against local CLI stubs; never install packages or touch real Codex settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-chrome-install-'));
const bin = path.join(temporary, 'mock bin');
fs.mkdirSync(bin);
const windows = process.platform === 'win32';

function stub(name, source) {
  fs.writeFileSync(path.join(bin, `${name}.cjs`), source);
  const executable = path.join(bin, windows ? `${name}.cmd` : name);
  fs.writeFileSync(executable, windows
    ? `@echo off\r\n"%INSTALL_TEST_NODE%" "%~dp0${name}.cjs" %*\r\n`
    : `#!/bin/sh\nexec "$INSTALL_TEST_NODE" "$(dirname "$0")/${name}.cjs" "$@"\n`, {mode: 0o755});
}

stub('npm', `
  require('node:fs').writeFileSync(process.env.INSTALL_TEST_NPM_RECORD, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}));
  process.exit(Number(process.env.INSTALL_TEST_NPM_EXIT || 0));
`);
stub('codex', `
  require('node:fs').writeFileSync(process.env.INSTALL_TEST_CODEX_RECORD, JSON.stringify(process.argv.slice(2)));
  process.exit(Number(process.env.INSTALL_TEST_CODEX_EXIT || 0));
`);

function run(name, flags = [], overrides = {}) {
  const checkout = path.join(temporary, name);
  fs.mkdirSync(path.join(checkout, 'server'), {recursive: true});
  fs.mkdirSync(path.join(checkout, 'skills/codex-in-chrome'), {recursive: true});
  fs.mkdirSync(path.join(checkout, 'scripts'), {recursive: true});
  fs.mkdirSync(path.join(checkout, 'extension'), {recursive: true});
  for(const relative of ['scripts/setup.mjs','server/keygen.mjs','extension/manifest.json']) fs.copyFileSync(path.join(root,relative),path.join(checkout,relative));
  fs.copyFileSync(path.join(root, 'install.mjs'), path.join(checkout, 'install.mjs'));
  fs.copyFileSync(path.join(root, 'server/config.json'), path.join(checkout, 'server/config.json'));
  fs.writeFileSync(path.join(checkout, 'skills/codex-in-chrome/SKILL.md'), 'isolated skill fixture\n');
  const home = path.join(checkout, 'codex home');
  const npmRecord = path.join(checkout, 'npm-record.json');
  const codexRecord = path.join(checkout, 'codex-record.json');
  const env = {...process.env, CODEX_HOME: home, INSTALL_TEST_NODE: process.execPath,
    INSTALL_TEST_NPM_RECORD: npmRecord, INSTALL_TEST_CODEX_RECORD: codexRecord,
    CODEX_CHROME_TEST_EXPAND: 'MUST_NOT_EXPAND', ...overrides};
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = bin + path.delimiter + (env[pathKey] || '');
  const result = spawnSync(process.execPath, [path.join(checkout, 'install.mjs'), ...flags], {
    cwd: checkout, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return {checkout, home, npmRecord, codexRecord, ...result};
}

try {
  for (const name of ['project with spaces', "project & (spaces)! %CODEX_CHROME_TEST_EXPAND% apostrophe's"]) {
    const result = run(name);
    assert.equal(result.status, 0, result.stderr);
    const expectedPath = path.join(result.checkout, 'server/mcp.js').replace(/\\/g, '/');
    assert.deepEqual(JSON.parse(fs.readFileSync(result.codexRecord, 'utf8')),
      ['mcp', 'add', 'codex-chrome', '--', 'node', expectedPath], 'checkout path must remain one literal argument');
    assert.deepEqual(JSON.parse(fs.readFileSync(result.npmRecord, 'utf8')),
      {args: ['install', '--omit=dev', '--no-audit', '--no-fund'], cwd: path.join(result.checkout, 'server')});
    assert.equal(fs.readFileSync(path.join(result.home, 'skills/codex-in-chrome/SKILL.md'), 'utf8'), 'isolated skill fixture\n');
  }

  const skipped = run('skip flags', ['--no-register', '--no-skill']);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert(!fs.existsSync(skipped.codexRecord), 'skip registration must not run Codex');
  assert(!fs.existsSync(skipped.home), 'skip skill must not write Codex settings');

  const failed = run('dependency failure', [], {INSTALL_TEST_NPM_EXIT: '7'});
  assert.equal(failed.status, 1);
  assert(!fs.existsSync(failed.codexRecord), 'dependency failure must stop before registration');
  assert(!fs.existsSync(failed.home), 'dependency failure must stop before skill installation');

  const fallback = run('registration failure', [], {INSTALL_TEST_CODEX_EXIT: '9'});
  assert.equal(fallback.status, 0, fallback.stderr);
  assert(fallback.stdout.includes('[mcp_servers.codex-chrome]'));
  const line = fallback.stdout.split('\n').find(line => line.startsWith('args = '));
  assert.deepEqual(JSON.parse(line.slice('args = '.length)),
    [path.join(fallback.checkout, 'server/mcp.js').replace(/\\/g, '/')]);
  console.log('INSTALLER VERIFIED');
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert(path.basename(temporary).startsWith('codex-chrome-install-'));
  fs.rmSync(temporary, {recursive: true, force: true});
}
