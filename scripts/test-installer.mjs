import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'codex-chrome-install-'));
const checkout=path.join(fixture,'checkout with spaces');
fs.mkdirSync(path.join(checkout,'scripts'),{recursive:true});
fs.mkdirSync(path.join(checkout,'server'));
fs.mkdirSync(path.join(checkout,'extension'));
fs.mkdirSync(path.join(checkout,'skills/codex-in-chrome'),{recursive:true});
fs.copyFileSync(path.join(root,'skills/codex-in-chrome/SKILL.md'),path.join(checkout,'skills/codex-in-chrome/SKILL.md'));
for(const file of ['scripts/setup.mjs','server/keygen.mjs','extension/manifest.json','install.cmd','uninstall.cmd','install.ps1','uninstall.ps1']) fs.copyFileSync(path.join(root,file),path.join(checkout,file));
const config=path.join(fixture,'Codex config','config.toml');
fs.mkdirSync(path.dirname(config));
const unrelated='# keep this comment\nmodel = "test-model"\nnote = """\n[mcp_servers.codex-chrome]\nThis is text inside a multiline value, not a table.\n"""\n\n[mcp_servers.other]\ncommand = "other"\n\n[features]\nkeep = true\n';
const stale='\n[mcp_servers.codex-chrome]\ncommand = "old-node"\nargs = ["old/path"]\n\n[mcp_servers.codex-chrome.tools.tabs]\napproval_mode = "prompt"\n';
fs.writeFileSync(config,unrelated+stale);
function run(action,extra=[]) {
 const r=spawnSync(process.execPath,[path.join(checkout,'scripts/setup.mjs'),action,'--config',config,'--skip-dependencies',...extra],{stdio:'inherit',windowsHide:true});
 assert.equal(r.status,0,String(r.error || 'Installer failed'));
}
try {
 run('install');
 const installed=fs.readFileSync(config,'utf8');
 assert(installed.includes(unrelated.trimEnd()));
 assert(installed.includes('default_tools_approval_mode = "approve"'));
 assert(!installed.includes('approval_mode = "prompt"'));
 assert.equal((installed.match(/\[mcp_servers.codex-chrome\]/g)||[]).length,2); // one literal string, one real table
 const installedSkill=path.join(path.dirname(config),'skills/codex-in-chrome/SKILL.md');
 assert.equal(fs.readFileSync(installedSkill,'utf8'),fs.readFileSync(path.join(root,'skills/codex-in-chrome/SKILL.md'),'utf8'));
 run('install');assert.equal(fs.readFileSync(config,'utf8'),installed,'reinstall must be idempotent');
 const cfg=JSON.parse(fs.readFileSync(path.join(checkout,'server/config.json'),'utf8'));
 assert.match(cfg.extId,/^[a-p]{32}$/);assert.equal(cfg.port,17333);
 run('uninstall');assert.equal(fs.readFileSync(config,'utf8'),unrelated);
 assert(!fs.existsSync(installedSkill));
 run('uninstall');assert.equal(fs.readFileSync(config,'utf8'),unrelated);
 assert(fs.readdirSync(path.dirname(config)).some(n=>n.includes('backup')));
 fs.writeFileSync(config,unrelated+stale);
 const denied=spawnSync(process.execPath,[path.join(checkout,'scripts/setup.mjs'),'uninstall','--config',config],{stdio:'inherit',windowsHide:true});
 assert.notEqual(denied.status,0,'another checkout must not be unregistered');
 assert.equal(fs.readFileSync(config,'utf8'),unrelated+stale);
 if(process.platform === 'win32') {
  // Real PowerShell launcher with paths containing spaces.
  const r=spawnSync('powershell.exe',['-NoProfile','-File',path.join(checkout,'install.ps1'),'--config',config,'--skip-dependencies'],{stdio:'inherit',windowsHide:true});
  assert.equal(r.status,0,String(r.error || 'PowerShell install failed'));
  const u=spawnSync('powershell.exe',['-NoProfile','-File',path.join(checkout,'uninstall.ps1'),'--config',config],{stdio:'inherit',windowsHide:true});
  assert.equal(u.status,0,String(u.error || 'PowerShell uninstall failed'));
  assert.equal(fs.readFileSync(config,'utf8'),unrelated);
  for(const action of ['install','uninstall']) {
   const launcher=path.join(checkout,action+'.cmd');
   const command=`""${launcher}" --config "${config}" --skip-dependencies"`;
   const result=spawnSync('cmd.exe',['/d','/s','/c',command],{stdio:'inherit',windowsHide:true,windowsVerbatimArguments:true});
   assert.equal(result.status,0,String(result.error || 'CMD launcher failed'));
  }
  assert.equal(fs.readFileSync(config,'utf8'),unrelated);
 }
 console.log('INSTALLER VERIFIED');
} finally {fs.rmSync(fixture,{recursive:true,force:true});}
