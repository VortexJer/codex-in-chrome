// Codex in Chrome - MCP stdio server. Spawns/joins the hub and forwards tool calls to the extension.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const URL_ = `ws://127.0.0.1:${cfg.port}/mcp`;

const INSTR = `Browser control via the user's real Chrome (own tab group "Codex"). Browser access is authorized in the extension panel. For routine actions within the user's requested task and saved scope, proceed without asking for duplicate browser-access consent in chat. Respect revocation, scope errors, host approval requirements, and any separate authorization required for consequential actions. Workflow: go {url} -> returns a compact snapshot (refs like e12). Act with do {steps:[...]} (batch many steps in ONE call; it returns only what changed). Steps: click REF | dblclick | rclick | hover | type REF TEXT | append REF TEXT | key Enter / Control+a | select REF VALUE | check/uncheck REF | scroll down|up|top|bottom|REF | wait 500|text:X|gone:X|url:X | goto URL | back | upload REF PATH | dialog accept. Use read for article text, shot only when layout matters, js/log for data/debug. Prefer refs over coordinates. Refs go stale after navigation: snap again.`;

const TOOLS = [
  { name: 'tabs', description: 'List/open/close/switch controlled tabs. action: list(default)|new|close|use|adopt|release. show brings the controlled tab to the front (only if the user asks to watch). adopt takes over ONLY the tab the user is currently viewing (ask them to open it first). Lists only controlled tabs.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'new', 'close', 'use', 'adopt', 'release', 'show'] }, tab: { type: 'number' }, url: { type: 'string' } } } },
  { name: 'go', description: 'Navigate (url, or back|forward|reload) and return a compact snapshot. Opens a tab if none. new:true forces a new tab; snap:"none" skips the snapshot.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, tab: { type: 'number' }, new: { type: 'boolean' }, snap: { type: 'string', enum: ['full', 'none'] } }, required: ['url'] } },
  { name: 'snap', description: 'Snapshot of the visible viewport: interactive elements with refs, headings, alerts. all:true includes offscreen; scope:ref limits to a subtree; diff:true returns only changes since last snapshot.',
    inputSchema: { type: 'object', properties: { tab: { type: 'number' }, scope: { type: 'string' }, all: { type: 'boolean' }, diff: { type: 'boolean' }, max: { type: 'number' } } } },
  { name: 'do', description: 'Run steps in order in one call; stops at first failure. Returns ok/FAIL plus a diff snapshot (snap: "diff"|"full"|"none"). Steps are strings: "click e5", "type e7 hello", "key Enter", "select e9 Spain", "check e3", "scroll down", "wait text:Done", "goto url", "upload e4 C:/f.png".',
    inputSchema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } }, tab: { type: 'number' }, snap: { type: 'string', enum: ['diff', 'full', 'none'] } }, required: ['steps'] } },
  { name: 'read', description: 'Readable page text (main content, no nav/footer). ref: limit to element; links:true appends hrefs; from/max page through long text.',
    inputSchema: { type: 'object', properties: { tab: { type: 'number' }, ref: { type: 'string' }, links: { type: 'boolean' }, from: { type: 'number' }, max: { type: 'number' } } } },
  { name: 'shot', description: 'Small JPEG screenshot of the viewport (or ref, or box:[x,y,w,h] in CSS px). Costs tokens: use only when layout/visuals matter. w = width px (default 700).',
    inputSchema: { type: 'object', properties: { tab: { type: 'number' }, ref: { type: 'string' }, w: { type: 'number' }, q: { type: 'number' }, box: { type: 'array', items: { type: 'number' } } } } },
  { name: 'js', description: 'Evaluate JavaScript in the page (top-level await ok, last expression returned). Output capped (max chars, default 2000). Return small, specific data.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, tab: { type: 'number' }, max: { type: 'number' } }, required: ['code'] } },
  { name: 'log', description: 'Console or network log of the tab. kind: console(default)|net. filter substring, n lines (30), body:<id> prints a response body, clear:true.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['console', 'net'] }, tab: { type: 'number' }, filter: { type: 'string' }, n: { type: 'number' }, body: { type: 'number' }, all: { type: 'boolean' }, clear: { type: 'boolean' } } } },
];

// ---- hub connection ----
let hub = null, hubP = null, nextId = 0;
const waiting = new Map();

function openHub() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL_);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error('hub down'));
  });
}
async function ensureHub() {
  if (hub && hub.readyState === 1) return hub;
  if (hubP) return hubP;
  hubP = (async () => {
    let ws;
    try { ws = await openHub(); }
    catch {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./hub.js', import.meta.url))], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 150)); try { ws = await openHub(); break; } catch {} }
      if (!ws) throw new Error('cannot start hub');
    }
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id); clearTimeout(w.t); w.res(m);
    };
    ws.onclose = () => { hub = null; for (const [k, w] of waiting) { clearTimeout(w.t); w.res({ error: 'hub connection lost' }); waiting.delete(k); } };
    hub = ws; return ws;
  })();
  try { return await hubP; } finally { hubP = null; }
}
async function callExt(method, params) {
  const ws = await ensureHub();
  const id = ++nextId;
  return new Promise(res => {
    const t = setTimeout(() => { waiting.delete(id); res({ error: 'timeout (60s)' }); }, 60000);
    waiting.set(id, { res, t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// ---- MCP stdio ----
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(m) {
  const { id, method, params } = m;
  if (method === 'initialize') {
    ensureHub().catch(() => {});
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'codex-chrome', version: '1.0.0' }, instructions: INSTR } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    let r;
    try { r = await callExt(params.name, params.arguments || {}); }
    catch (e) { r = { error: e.message }; }
    if (r.error) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ERR: ' + r.error }], isError: true } });
    return send({ jsonrpc: '2.0', id, result: r.result });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) { try { handle(JSON.parse(line)); } catch {} }
  }
});
process.stdin.on('end', () => process.exit(0));
