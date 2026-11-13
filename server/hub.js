// Codex in Chrome hub: relays MCP shims (/mcp) <-> Chrome extension (/ext). Local only.
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
let ext = null, seq = 0;
const pending = new Map(); // hubId -> {client, id}

const server = http.createServer((req, res) => {
  if (req.url === '/status') { res.end(JSON.stringify({ ext: !!ext && ext.readyState === 1 })); return; }
  res.statusCode = 404; res.end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

server.on('upgrade', (req, sock, head) => {
  const origin = req.headers.origin;
  const ok = req.url === '/ext' ? origin === `chrome-extension://${cfg.extId}`
    : req.url === '/mcp' ? !origin   // browsers always send Origin; MCP shims never do
    : false;
  if (!ok || req.socket.remoteAddress.replace('::ffff:', '') !== '127.0.0.1' && req.socket.remoteAddress !== '::1') { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => {
    if (req.url === '/ext') onExt(ws); else onClient(ws);
  });
});

function onExt(ws) {
  if (ext && ext.readyState === 1) try { ext.close(); } catch {}
  ext = ws;
  setTimeout(announce, 100);
  ws.on('message', d => {
    const s = d.toString();
    let m; try { m = JSON.parse(s); } catch { return; }
    if (m.ping) { ws.send('{"pong":1}'); return; }
    const p = pending.get(m.id); if (!p || p.extension !== ws) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (p.client.readyState === 1) p.client.send(JSON.stringify({ id: p.id, result: m.result, error: m.error }));
  });
  ws.on('close', () => {
    if (ext === ws) ext = null;
    for (const [k, p] of pending) {
      if (p.extension !== ws) continue;
      clearTimeout(p.timer);
      if (p.client.readyState === 1) p.client.send(JSON.stringify({ id: p.id, error: 'extension disconnected' }));
      pending.delete(k);
    }
  });
}

const clients = new Set();
const announce = () => { if (ext && ext.readyState === 1) ext.send(JSON.stringify({ clients: clients.size })); };

function onClient(ws) {
  clients.add(ws); announce();
  ws.on('message', d => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (!ext || ext.readyState !== 1) {
      ws.send(JSON.stringify({ id: m.id, error: 'Chrome extension not connected. Open Chrome with the "Codex in Chrome" extension enabled (chrome://extensions) and not paused.' }));
      return;
    }
    const hid = ++seq;
    const extension = ext;
    const deadline = Date.now() + 55000;
    const timer = setTimeout(() => {
      if (!pending.delete(hid)) return;
      if (ws.readyState === 1) ws.send(JSON.stringify({id: m.id, error: 'extension request timed out; verify the page before retrying a write'}));
    }, 55000);
    timer.unref();
    pending.set(hid, { client: ws, id: m.id, extension, timer });
    extension.send(JSON.stringify({ id: hid, method: m.method, params: m.params, deadline }));
  });
  ws.on('close', () => { clients.delete(ws); announce(); for (const [k, p] of pending) if (p.client === ws) { clearTimeout(p.timer); pending.delete(k); } });
}

server.on('error', e => { if (e.code === 'EADDRINUSE') process.exit(0); else throw e; });
server.listen(cfg.port, '127.0.0.1');
