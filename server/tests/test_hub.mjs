// Real sockets, isolated ephemeral port, copied unmodified hub, no live Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(here, '.hub-'));
const sockets = [];
let child;
const delay = ms => new Promise(r => setTimeout(r, ms));
function open(url, origin) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, origin ? {origin} : {});
    sockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}
function next(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {socket.off('message', handler); reject(new Error('message timeout'));}, 2500);
    const handler = data => {
      const message = JSON.parse(data);
      if (message.id === undefined) return; // side-panel client counts and keepalives are not replies
      clearTimeout(timeout); socket.off('message', handler); resolve(message);
    };
    socket.on('message', handler);
  });
}
try {
  const reservation = net.createServer();
  await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise(r => reservation.close(r));
  const id = 'a'.repeat(32), base = `ws://127.0.0.1:${port}`;
  fs.copyFileSync(path.join(here, '../hub.js'), path.join(tmp, 'hub.js'));
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({port, extId:id}));
  child = spawn(process.execPath, [path.join(tmp, 'hub.js')], {stdio:'inherit', windowsHide:true});
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {await fetch(`http://127.0.0.1:${port}/status`); ready = true; break;} catch {await delay(50);}
  }
  assert(ready, 'isolated hub starts');
  await assert.rejects(open(base + '/ext', 'https://untrusted.invalid'));
  await assert.rejects(open(base + '/mcp', 'https://untrusted.invalid'));
  const ext = await open(base + '/ext', `chrome-extension://${id}`);
  const a = await open(base + '/mcp'), b = await open(base + '/mcp');
  const firstCommand = next(ext), firstResult = next(a);
  a.send(JSON.stringify({id:1, method:'test', params:{value:'a'}}));
  const ca = await firstCommand;
  ext.send(JSON.stringify({id:ca.id, result:{value:'a'}}));
  assert.deepEqual((await firstResult).result, {value:'a'});
  const secondCommand = next(ext), secondResult = next(b);
  b.send(JSON.stringify({id:1, method:'test', params:{value:'b'}}));
  const cb = await secondCommand;
  assert.notEqual(ca.id, cb.id, 'hub IDs isolate equal client IDs');
  ext.send(JSON.stringify({id:cb.id, result:{value:'b'}}));
  assert.deepEqual((await secondResult).result, {value:'b'});
  const command = next(ext), failed = next(a);
  a.send(JSON.stringify({id:2, method:'test', params:{}}));
  await command; ext.close();
  assert.match((await failed).error, /disconnected/);
  console.log('LEAN HUB VERIFIED');
} finally {
  for (const socket of sockets) socket.terminate();
  if (child) {const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended;}
  assert.equal(path.dirname(tmp), here);
  fs.rmSync(tmp, {recursive:true, force:true});
}
