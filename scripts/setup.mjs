import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2];
const args = process.argv.slice(3);
const configArg = args.indexOf('--config');
const known = new Set(['--config', '--skip-dependencies', '--no-skill']);
for(let i=0;i<args.length;i++) {
 if (!known.has(args[i])) throw new Error('Unknown option: ' + args[i]);
 if (args[i] === '--config' && !args[++i]) throw new Error('--config requires a file path');
}
if (!['install','uninstall'].includes(command)) throw new Error('Usage: node scripts/setup.mjs install|uninstall [--config FILE] [--skip-dependencies]');
const config = path.resolve(configArg < 0 ? path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),'config.toml') : args[configArg+1]);
const entry = path.join(root,'server','mcp.js');
const node = process.execPath;
const skillSource = path.join(root,'skills','codex-in-chrome','SKILL.md');
const skillTarget = path.join(path.dirname(config),'skills','codex-in-chrome','SKILL.md');
function updateSkill(install) {
 if(args.includes('--no-skill') || !fs.existsSync(skillSource)) return;
 const source=fs.readFileSync(skillSource,'utf8');
 if(install) {
  fs.mkdirSync(path.dirname(skillTarget),{recursive:true});
  if(fs.existsSync(skillTarget) && fs.readFileSync(skillTarget,'utf8')!==source) fs.copyFileSync(skillTarget,skillTarget+'.backup-'+Date.now());
  fs.writeFileSync(skillTarget,source);
  console.log('Installed Codex skill: '+skillTarget);
 } else if(fs.existsSync(skillTarget) && fs.readFileSync(skillTarget,'utf8')===source) {
  fs.unlinkSync(skillTarget);
  if(!fs.readdirSync(path.dirname(skillTarget)).length) fs.rmdirSync(path.dirname(skillTarget));
  console.log('Removed unmodified Codex skill.');
 }
}
const header = /^\s*\[([^\]\r\n]+)\]\s*(?:#.*)?$/;
const owned = name => /^mcp_servers\.(?:codex-chrome|"codex-chrome"|'codex-chrome')(?:\.|$)/.test(name);
function sections(text) {
 const lines = text.split(/\r?\n/), blocks=[];
 let current={name:'', lines:[]};
 let multiline=null;
 for(const line of lines) {
  const match=multiline ? null : header.exec(line);
  if(match){blocks.push(current);current={name:match[1],lines:[]};}
  current.lines.push(line);
  for(let i=0;i<line.length;) {
   if(multiline) {
    if(line.startsWith(multiline,i)){i+=3;multiline=null;}
    else if(multiline==='"""' && line[i]==='\\') i+=2;
    else i++;
   } else {
    if(line[i]==='#') break;
    const quote=line[i];
    if(quote==='"' || quote==="'") {
     if(line.startsWith(quote.repeat(3),i)){multiline=quote.repeat(3);i+=3;}
     else {i++;while(i<line.length){if(quote==='"' && line[i]==='\\'){i+=2;continue;}if(line[i++]===quote) break;}}
    } else i++;
   }
  }
 }
 if(multiline) throw new Error('Unterminated multiline string in Codex config; no changes made.');
 blocks.push(current);return blocks;
}
const before = fs.existsSync(config) ? fs.readFileSync(config,'utf8') : '';
const blocks = sections(before);
const existing = blocks.filter(b=>owned(b.name)).map(b=>b.lines.join('\n')).join('\n');
const quote = value => JSON.stringify(value.replaceAll('\\','/'));
if(command === 'uninstall') {
 if(!existing){updateSkill(false);console.log('Already uninstalled. No Codex configuration changed.');process.exit(0);}
 // Never unregister another checkout's connector.
 if(!existing.includes(quote(entry))) throw new Error('This connector belongs to another location. Run uninstall from that location.');
} else {
 if(Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
 const generated=spawnSync(node,[path.join(root,'server/keygen.mjs')],{stdio:'inherit',windowsHide:true});
 if(generated.status!==0) process.exit(generated.status || 1);
 if(!args.includes('--skip-dependencies')) {
  const installed = process.platform === 'win32'
   ? spawnSync('cmd.exe',['/d','/s','/c','npm ci --omit=dev --no-audit --no-fund'],{cwd:path.join(root,'server'),stdio:'inherit',windowsHide:true})
   : spawnSync('npm',['ci','--omit=dev','--no-audit','--no-fund'],{cwd:path.join(root,'server'),stdio:'inherit'});
  if(installed.status!==0) throw new Error('Dependency installation failed. Codex configuration was not changed.');
 }
}
// Preserve all unrelated sections byte for byte apart from newline normalization.
let after = blocks.filter(b=>!owned(b.name)).map(b=>b.lines.join('\n')).join('\n').trimEnd();
if(command === 'install') after += `\n\n[mcp_servers.codex-chrome]\ncommand = ${quote(node)}\nargs = [${quote(entry)}]\nstartup_timeout_sec = 20.0\ndefault_tools_approval_mode = "approve"\n`;
else after += '\n';
if(before.replaceAll('\r\n','\n') !== after) {
 fs.mkdirSync(path.dirname(config),{recursive:true});
 if(fs.existsSync(config)) {
  const backup=config+'.codex-chrome-backup-'+Date.now()+'-'+process.pid;
  fs.copyFileSync(config,backup,fs.constants.COPYFILE_EXCL);
  console.log('Config backup: ' + backup);
 }
 const tmp=config+'.codex-chrome-'+process.pid+'.tmp';
 try {fs.writeFileSync(tmp,after,{flag:'wx'});fs.renameSync(tmp,config);}
 finally {if(fs.existsSync(tmp)) fs.unlinkSync(tmp);}
}
if(command === 'install') {
 updateSkill(true);
 console.log('Installed Codex MCP connector: ' + config);
 console.log('Chrome: open chrome://extensions, enable Developer mode, then Load unpacked:');
 console.log(path.join(root,'extension'));
 console.log('Open the extension panel and Save authorization: read and interact / all websites / permanent.');
 console.log('Restart Codex to load this connector and its per-server approval setting.');
} else {
 updateSkill(false);
 console.log('Removed this connector from Codex. Restart Codex to disconnect existing sessions.');
 console.log('In the extension panel choose Stop and revoke, then remove Codex in Chrome at chrome://extensions.');
 console.log('Source files and other connectors were kept. Delete this checkout when you no longer need it.');
}
