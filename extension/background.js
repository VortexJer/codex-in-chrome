// Codex in Chrome - service worker. Bridges the local hub (WebSocket) to Chrome tabs.
importScripts('access.js');
importScripts('logo.js');
const PORT = 17333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cut = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);

let codexWin = null, ws = null, paused = false, ctl = new Set(), cur = null, groupId = null, dialogPolicy = 'dismiss';
const attached = new Set(), bufs = new Map();
const policyDetached = new Set();
let netSeq = 0;
let accessSession;
// Never let this promise reject: "No SW" is thrown when Chrome stops/reloads the worker mid-read, and a rejected
// accessReady would make every later accessPolicy() fail until the worker restarts. Retry, then fall back.
const accessReady = (async () => {
  for (let i = 0; i < 4; i++) {
    try {
      const s = await chrome.storage.session.get('codexAccessSession');
      accessSession = s.codexAccessSession || crypto.randomUUID();
      if (!s.codexAccessSession) await chrome.storage.session.set({codexAccessSession:accessSession});
      return;
    } catch { await new Promise(r => setTimeout(r, 250 * (i + 1))); }
  }
  accessSession = accessSession || crypto.randomUUID();
})();
async function accessPolicy() { await accessReady; return (await chrome.storage.local.get('codexAccess')).codexAccess || {}; }
async function requireUrl(url) {
  if (!CodexAccess.allowed(await accessPolicy(), url, accessSession)) throw new Error('site not authorized or access expired; change the scope in the extension panel');
}
async function requireTab(tabId) {
  if (paused || !ctl.has(tabId)) throw new Error('paused or tab is not controlled');
  await requireUrl((await chrome.tabs.get(tabId)).url || 'about:blank');
}
async function enforceAccess() {
  const policy = await accessPolicy();
  for (const tabId of [...attached]) {
    let allowed = false;
    try {allowed = !paused && CodexAccess.allowed(policy, (await chrome.tabs.get(tabId)).url, accessSession);} catch {}
    if (!allowed) {
      policyDetached.add(tabId);
      try {await chrome.debugger.detach({tabId});} catch {policyDetached.delete(tabId);}
      attached.delete(tabId); bufs.delete(tabId);
    }
  }
  void badge();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.paused) paused = !!changes.paused.newValue;
  if (changes.codexAccess || changes.paused) void enforceAccess();
});

// ---------- state ----------
const ready = (async () => {
  try {
    const s = await chrome.storage.session.get(['ctl', 'cur', 'groupId', 'paused', 'codexWin']);
    ctl = new Set(s.ctl || []); cur = s.cur ?? null; groupId = s.groupId ?? null; codexWin = s.codexWin ?? null; paused = !!s.paused;
  } catch {}
  badge();
})();
const save = () => chrome.storage.session.set({ ctl: [...ctl], cur, groupId, paused, codexWin }).catch(() => {});

let clients = 0, lastIcon = '';
const ACT = [];
const note = (what, err) => { ACT.push({ time: new Date().toLocaleTimeString('es-ES', { hour12: false }), what, err }); if (ACT.length > 15) ACT.shift(); };
function iconFor(color) {
  const imageData = {};
  for (const s of [16, 32, 48, 128]) {
    const c = new OffscreenCanvas(s, s), x = c.getContext('2d');
    x.scale(s / 24, s / 24); x.fillStyle = color; x.fill(new Path2D(LOGO_PATH));
    imageData[s] = x.getImageData(0, 0, s, s);
  }
  return imageData;
}
// off = no Codex session, wait = connected but idle, work = debugging a tab, pause = stopped by the user
const COLORS = { off: '#8a8f98', wait: '#f5a524', work: '#10a37f', pause: '#e5534b' };
const TITLES = { off: 'sin sesiones de Codex', wait: 'conectado, en espera', work: 'depurando', pause: 'pausado' };
const modeNow = granted => paused ? 'pause' : !(ws && ws.readyState === 1) ? 'off' : granted && attached.size > 0 ? 'work' : clients > 0 ? 'wait' : 'off';
async function badge() {
  const open = ws && ws.readyState === 1;
  let granted = false;
  try { granted = CodexAccess.enabled(await accessPolicy(), accessSession); } catch {}
  const st = modeNow(granted), color = COLORS[st];
  if (color !== lastIcon) { lastIcon = color; chrome.action.setIcon({ imageData: iconFor(color) }).catch(() => {}); }
  chrome.action.setBadgeText({ text: paused ? 'II' : '' }); chrome.action.setBadgeBackgroundColor({ color: '#d29922' });
  chrome.action.setTitle({ title: 'Codex in Chrome — ' + TITLES[st] + (st === 'wait' && !granted ? ' (sin permisos: abre el panel)' : '') });
}
// Clicking the icon opens the side panel (stays open, unlike a popup). Its page is permissions.html.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Release the debugger after 45 s without activity: Chrome's yellow banner disappears and the icon goes back to grey.
let lastAct = Date.now();
setInterval(async () => {
  if (!attached.size || busy || paused || Date.now() - lastAct < 45000) return;
  for (const t of [...attached]) { policyDetached.add(t); try { await chrome.debugger.detach({ tabId: t }); attached.delete(t); } catch { policyDetached.delete(t); } }
  void badge();
}, 5000);

async function setPaused(v) {
  paused = v;
  if (paused) for (const t of [...attached]) { policyDetached.add(t); try { await chrome.debugger.detach({ tabId: t }); } catch { policyDetached.delete(t); } }
  save(); badge();
}
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (_s.id !== chrome.runtime.id || !_s.url?.startsWith(chrome.runtime.getURL('permissions.html'))) return;
  (async () => {
    await ready;
    if (m.t === 'state') {
      const tabs = [];
      for (const id of ctl) { try { const t = await chrome.tabs.get(id); tabs.push({ id, title: t.title, url: short(t.url), cur: id === cur }); } catch {} }
      let granted = false;
      try { granted = CodexAccess.enabled(await accessPolicy(), accessSession); } catch {}
      let winState = null; try { winState = codexWin != null ? (await chrome.windows.get(codexWin)).state : null; } catch {}
      reply({ winState, connected: !!(ws && ws.readyState === 1), paused, granted, clients, debugging: attached.size > 0, mode: modeNow(granted), tabs, log: ACT });
    } else if (m.t === 'pause') { await setPaused(!paused); reply({ paused }); }
    else if (m.t === 'showwin' || m.t === 'hidewin') {
      if (codexWin == null) { reply({ none: true }); return; }
      if (m.t === 'showwin') await chrome.windows.update(codexWin, { state: 'normal', focused: true });
      else await chrome.windows.update(codexWin, { state: 'minimized' });
      reply({ ok: 1 });
    } else if (m.t === 'release') { await H.tabs({ action: 'release', tab: m.id }); reply({ ok: 1 }); }
  })().catch(error => reply({error: error.message}));
  return true;
});

// ---------- websocket ----------
let connecting = false;
async function connect() {
  if (connecting || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
  connecting = true;
  // Probe first: a failed WebSocket handshake is logged by Chrome as an extension error on every retry,
  // a failed fetch caught here is not. The hub only runs while Codex has an MCP session.
  try { const r = await fetch(`http://127.0.0.1:${PORT}/status`, { cache: 'no-store' }); if (!r.ok) return; }
  catch { return; }
  finally { connecting = false; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}/ext`); } catch { return; }
  ws.onopen = () => { badge(); };
  ws.onclose = ws.onerror = () => { clients = 0; badge(); };
  ws.onmessage = async ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.pong) return;
    if (m.clients !== undefined) { clients = m.clients; void badge(); return; }
    if (!m.method) return;
    await ready;
    try {
      if (paused) throw new Error('paused by the user (extension icon). Ask them to resume.');
      if (m.deadline && Date.now() > m.deadline) throw new Error('request expired; not executed');
      CodexAccess.checkTool(await accessPolicy(), accessSession, m.method, m.params || {});
      const h = H[m.method]; if (!h) throw new Error('unknown tool ' + m.method);
      const t0 = Date.now();
      const diag = m.method[0] === '_';
      if (!diag) { lastAct = Date.now(); busy++; void groupState('work'); }
      let result;
      try { result = await h(m.params || {}); }
      finally { if (!diag) busy--; }
      if (!diag && !busy) void groupState(result.isError ? 'err' : 'done');
      note(m.method + (m.params?.url ? ' ' + short(m.params.url) : m.params?.steps ? ' x' + m.params.steps.length : '') + ' (' + (Date.now() - t0) + 'ms)', result.isError ? 'falló' : undefined);
      ws.send(JSON.stringify({ id: m.id, result }));
    } catch (e) {
      note(m.method, cut(String(e.message || e), 80));
      if (!busy) void groupState('err');
      try { ws.send(JSON.stringify({ id: m.id, error: String(e.message || e) })); } catch {}
    }
  };
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"ping":1}'); else connect(); void enforceAccess(); }, 20000);
chrome.alarms.create('keep', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

// ---------- helpers ----------
const T = text => ({ content: [{ type: 'text', text }] });
const short = u => cut((u || '').replace(/^https?:\/\/(www\.)?/, ''), 80);
const pref = s => { const m = /^(?:f(\d+))?(e\d+)$/.exec((s || '').trim()); return m ? { frame: +(m[1] || 0), ref: m[2] } : null; };

async function addToGroup(tabId) {
  try {
    // Never call tabs.group() without a windowId: it would create the group in the user's current window and MOVE the tab there.
    const t = await chrome.tabs.get(tabId);
    if (groupId != null) {
      const g = await chrome.tabGroups.get(groupId).catch(() => null);
      if (g && g.windowId === t.windowId) { await chrome.tabs.group({ tabIds: [tabId], groupId }); return; }
      groupId = null;
    }
    groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: t.windowId } });
    await chrome.tabGroups.update(groupId, { title: 'Codex', color: 'cyan' });
  } catch {}
}
// Group title shows what Codex is doing: ⏳ working, ✓ finished, ⚠ last call failed.
let busy = 0;
async function groupState(s) {
  if (groupId == null) return;
  try { await chrome.tabGroups.update(groupId, { title: (s === 'work' ? '⏳ ' : s === 'done' ? '✓ ' : s === 'err' ? '⚠ ' : '') + 'Codex', color: 'cyan' }); }
  catch { groupId = null; }
}

async function newTab(url) {
  // Work in the window the user is using right now, as a background tab inside the Codex group.
  // The tab is never activated, so the user's own tab and focus are untouched.
  let t = null;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && win.id != null) t = await chrome.tabs.create({ windowId: win.id, url: url || 'about:blank', active: false });
  } catch {}
  if (!t) { // no Chrome window at all: open one, minimized
    const w = await chrome.windows.create({ url: url || 'about:blank', focused: false, state: 'minimized' });
    t = w.tabs[0]; try { await chrome.windows.update(w.id, { state: 'minimized' }); } catch {}
  }
  ctl.add(t.id); cur = t.id; await addToGroup(t.id); save();
  return t;
}

// Chrome drops CDP mouse/keyboard input for hidden tabs: make the tab visible first.
async function ensureVisible(tabId) {
  await focusEmulation(tabId); // never activate the tab or focus a window: the user keeps what they are looking at
}
const emulated = new Set();
async function focusEmulation(tabId) {
  if (emulated.has(tabId)) return;
  try { await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }); emulated.add(tabId); } catch {}
}

async function resolveTab(p, { create } = {}) {
  const id = p.tab ?? cur;
  if (id != null) {
    let t = null;
    try { t = await chrome.tabs.get(id); } catch {}
    if (t) {
      if (!ctl.has(id)) throw new Error(`tab ${id} is not controlled (only Codex-group tabs, or the user's active tab via tabs {action:"adopt"}).`);
      await requireUrl(t.url || 'about:blank');
      cur = id; return t;
    }
    ctl.delete(id); if (cur === id) cur = null; save();
  }
  if (create) return newTab('about:blank');
  throw new Error('no controlled tab. Use go {url} or tabs {action:"new"}.');
}

chrome.tabs.onRemoved.addListener(id => { ctl.delete(id); attached.delete(id); bufs.delete(id); if (cur === id) cur = null; save(); });

// ---------- CDP ----------
const cdp = async (tabId, method, params = {}) => {
  await requireTab(tabId);
  try { return await chrome.debugger.sendCommand({ tabId }, method, params); }
  catch (e) {
    if (!/not attached|detached/i.test(e.message || '')) throw e;
    attached.delete(tabId); await attach(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }
};
async function attach(tabId) {
  await requireTab(tabId);
  if (attached.has(tabId)) return;
  policyDetached.delete(tabId); // a new debugging session must not inherit a previous detach marker
  emulated.delete(tabId);      // ...nor a previous focus-emulation flag (the emulation dies with the session)
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (e) { if (!/already attached/i.test(e.message)) throw new Error('cannot attach debugger: ' + e.message); }
  attached.add(tabId); void badge(); await focusEmulation(tabId);
  bufs.set(tabId, { con: [], net: [], map: new Map() });
  for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await cdp(tabId, m).catch(() => {});
}
chrome.debugger.onDetach.addListener((src, reason) => {
  attached.delete(src.tabId); emulated.delete(src.tabId); void badge();
  const byPolicy = policyDetached.delete(src.tabId);
  if (reason === 'canceled_by_user' && !byPolicy) { ctl.delete(src.tabId); if (cur === src.tabId) cur = null; save(); }
});
const redact = u => { try { const x = new URL(u); for (const k of [...x.searchParams.keys()]) if (/token|key|auth|secret|pass|sig|session/i.test(k)) x.searchParams.set(k, 'X'); return short(x.href); } catch { return short(u); } };
chrome.debugger.onEvent.addListener((src, method, p) => {
  const b = bufs.get(src.tabId); if (!b) return;
  const pushCon = s => { b.con.push(cut(s, 300)); if (b.con.length > 200) b.con.shift(); };
  switch (method) {
    case 'Runtime.consoleAPICalled':
      pushCon(`${p.type}: ` + (p.args || []).map(a => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type)).join(' ')); break;
    case 'Runtime.exceptionThrown': {
      const d = p.exceptionDetails || {}; pushCon('error: ' + (d.exception?.description || d.text || '').split('\n')[0]); break;
    }
    case 'Log.entryAdded': if (['error', 'warning'].includes(p.entry.level)) pushCon(`${p.entry.level}: ${p.entry.text} ${p.entry.url ? short(p.entry.url) : ''}`); break;
    case 'Network.requestWillBeSent': {
      const e = { id: ++netSeq, rid: p.requestId, method: p.request.method, url: p.request.url, type: (p.type || '').toLowerCase(), status: '', size: 0 };
      b.net.push(e); b.map.set(p.requestId, e); if (b.net.length > 400) { const o = b.net.shift(); b.map.delete(o.rid); } break;
    }
    case 'Network.responseReceived': { const e = b.map.get(p.requestId); if (e) e.status = p.response.status; break; }
    case 'Network.loadingFinished': { const e = b.map.get(p.requestId); if (e) e.size = p.encodedDataLength; break; }
    case 'Network.loadingFailed': { const e = b.map.get(p.requestId); if (e) e.status = 'FAIL ' + (p.errorText || ''); break; }
    case 'Page.frameNavigated': if (!p.frame.parentId) { b.net.length = 0; b.map.clear(); } break;
    case 'Page.javascriptDialogOpening': {
      const accept = p.type === 'alert' || p.type === 'beforeunload' || dialogPolicy === 'accept';
      b.dialog = `${p.type} "${cut(p.message || '', 80)}" → ${accept ? 'accepted' : 'dismissed'}`;
      cdp(src.tabId, 'Page.handleJavaScriptDialog', { accept }).catch(() => {}); break;
    }
  }
});

// ---------- page lib ----------
async function ensure(tabId) {
  await requireTab(tabId);
  try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['cx.js'] }); }
  catch (e) { throw new Error('cannot access this page (' + cut(e.message, 80) + ')'); }
}
async function call(tabId, frameId, fn, ...args) {
  const run = async () => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (fn, args) => (window.__cx ? window.__cx[fn](...args) : { err: 'nocx' }), args: [fn, args] });
    return r?.result;
  };
  let r;
  try { r = await run(); } catch { await sleep(300); await ensure(tabId); r = await run(); }
  if (r && r.err === 'nocx') { await ensure(tabId); r = await run(); }
  if (r && r.err) throw new Error(r.err);
  return r;
}
async function waitComplete(tabId, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return; await sleep(100); }
}
async function afterAction(tabId, quick) {
  await sleep(quick ? 30 : 80);
  const t = await chrome.tabs.get(tabId);
  if (t.status === 'loading') await waitComplete(tabId);
  if (!quick) { try { await call(tabId, 0, 'settle', 90, 500); } catch {} }
}
async function navigate(tabId, url) {
  await requireTab(tabId);
  if (url === 'back' || url === 'forward') {
    const history = await cdp(tabId, 'Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + (url === 'back' ? -1 : 1)];
    if (!entry) throw new Error('no history entry');
    await requireUrl(entry.url);
  } else if (url !== 'reload') {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    await requireUrl(url);
  }
  if (url === 'back') await chrome.tabs.goBack(tabId);
  else if (url === 'forward') await chrome.tabs.goForward(tabId);
  else if (url === 'reload') await chrome.tabs.reload(tabId);
  else {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    await chrome.tabs.update(tabId, { url });
  }
  await sleep(100); await waitComplete(tabId, 20000);
  try { await ensure(tabId); await call(tabId, 0, 'settle', 200, 1500); } catch {}
}

// ---------- snapshot ----------
const prefixRefs = (text, fid) => (fid ? text.replace(/^(\s*(?:[+~-] )?)(e\d+)(?=\s|$)/gm, `$1f${fid}$2`) : text);
async function snapText(tabId, o = {}) {
  await ensure(tabId);
  const sc = o.scope ? pref(o.scope) : null;
  if (o.scope && !sc) throw new Error('bad scope ' + o.scope);
  const opts = { scope: sc?.ref, all: !!o.all, diff: !!o.diff };
  const target = sc ? { tabId, frameIds: [sc.frame] } : { tabId, allFrames: true };
  const res = await chrome.scripting.executeScript({ target, func: o => (window.__cx ? window.__cx.snapshot(o) : null), args: [opts] });
  const main = res.find(r => r.frameId === 0 || sc)?.result;
  if (!main) throw new Error('empty page');
  if (main.err) throw new Error(main.err);
  const parts = [];
  if (!o.noHead && main.mode === 'full') parts.push(`${cut(main.title || '', 80)} · ${short(main.url)}`);
  if (main.text) parts.push(main.text);
  if (!sc) for (const r of res) {
    if (r.frameId === 0 || !r.result || r.result.err || !r.result.text) continue;
    if (r.result.mode === 'diff' && r.result.text === '(no change)') continue;
    if (r.result.n === 0 && r.result.mode === 'full') continue;
    let host = ''; try { host = new URL(r.result.url).host; } catch {}
    parts.push(`[frame ${host || 'inline'}]`); parts.push(prefixRefs(r.result.text, r.frameId));
  }
  if (parts.length === (main.mode === 'full' && !o.noHead ? 1 : 0)) parts.push('(empty)');
  if (parts.length === 1 && main.mode === 'diff') { /* just no change */ }
  if (main.foot) parts.push(main.foot);
  let out = parts.join('\n');
  const max = o.max || 6000;
  if (out.length > max) {
    const lines = out.slice(0, max).split('\n'); lines.pop();
    out = lines.join('\n') + `\n…truncated (${out.length} chars). Use snap {scope:ref}, or read.`;
  }
  return out;
}

// ---------- keys / input ----------
const KEYS = { enter: [13, 'Enter', 'Enter', '\r'], return: [13, 'Enter', 'Enter', '\r'], tab: [9, 'Tab', 'Tab'], escape: [27, 'Escape', 'Escape'], esc: [27, 'Escape', 'Escape'],
  backspace: [8, 'Backspace', 'Backspace'], delete: [46, 'Delete', 'Delete'], arrowup: [38, 'ArrowUp', 'ArrowUp'], up: [38, 'ArrowUp', 'ArrowUp'],
  arrowdown: [40, 'ArrowDown', 'ArrowDown'], down: [40, 'ArrowDown', 'ArrowDown'], arrowleft: [37, 'ArrowLeft', 'ArrowLeft'], left: [37, 'ArrowLeft', 'ArrowLeft'],
  arrowright: [39, 'ArrowRight', 'ArrowRight'], right: [39, 'ArrowRight', 'ArrowRight'], home: [36, 'Home', 'Home'], end: [35, 'End', 'End'],
  pageup: [33, 'PageUp', 'PageUp'], pagedown: [34, 'PageDown', 'PageDown'], space: [32, ' ', 'Space', ' '] };
const CMDS = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo', y: 'redo' };
async function pressKey(tabId, combo) {
  const parts = combo.split('+'); let key = parts.pop() || '+'; let mods = 0;
  for (const m of parts) { const l = m.toLowerCase(); mods |= l === 'alt' ? 1 : /^(ctrl|control)$/.test(l) ? 2 : /^(meta|cmd|win)$/.test(l) ? 4 : l === 'shift' ? 8 : 0; }
  let vk, k, code, text;
  const d = KEYS[key.toLowerCase()];
  if (d) [vk, k, code, text] = d;
  else if (key.length === 1) {
    k = (mods & 8) ? key.toUpperCase() : key; const u = key.toUpperCase(); vk = u.charCodeAt(0);
    code = /[a-z]/i.test(key) ? 'Key' + u : /\d/.test(key) ? 'Digit' + key : ''; text = k;
  } else if (/^f\d+$/i.test(key)) { vk = 111 + +key.slice(1); k = code = key.toUpperCase(); }
  else throw new Error('unknown key ' + key);
  const typed = text && !(mods & 6);
  const base = { modifiers: mods, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  const commands = (mods & 2) && CMDS[key.toLowerCase()] ? [CMDS[key.toLowerCase()]] : undefined;
  await sendCapped(tabId, [['Input.dispatchKeyEvent', { ...base, type: typed ? 'keyDown' : 'rawKeyDown', text: typed ? text : undefined, commands }], ['Input.dispatchKeyEvent', { ...base, type: 'keyUp' }]], 900, { type: 'keyup', need: 1 });
}
const sendRaw = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
// Page-side counters (isolated world) tell us when an injected event really reached the page.
const armInput = tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
  if (!window.__cxCnt) { window.__cxCnt = { mouseup: 0, mousemove: 0, keyup: 0, input: 0 }; for (const t in window.__cxCnt) addEventListener(t, () => { window.__cxCnt[t]++; }, true); }
  return { ...window.__cxCnt };
} }).then(r => r[0].result, () => null);
const seenInput = (tabId, type) => chrome.scripting.executeScript({ target: { tabId }, func: t => (window.__cxCnt ? window.__cxCnt[t] : 0), args: [type] }).then(r => r[0].result, () => null);
// Send a burst of CDP commands in order. Hidden/minimized windows ack slowly, so instead of awaiting every ack
// we wait until the page itself saw the expected event (expect = {type, need}); no event within 900 ms = error.
async function sendCapped(tabId, cmds, capMs = 900, expect = null, retried = false) {
  await requireTab(tabId);
  const base = expect ? await armInput(tabId) : null;
  const ps = cmds.map(([m, p]) => sendRaw(tabId, m, p).then(() => null, e => e)); // queued in order
  const acked = Promise.all(ps);
  const t0 = Date.now(); let r = null;
  while (Date.now() - t0 < capMs) {
    const x = await Promise.race([acked, sleep(20).then(() => 'tick')]);
    if (x !== 'tick') { r = x; break; }
    if (expect && base) {
      const n = await seenInput(tabId, expect.type);
      if (n === null || n - base[expect.type] >= expect.need) break; // seen (or the page navigated away)
    }
  }
  const err = Array.isArray(r) && r.find(Boolean);
  if (err) {
    if (!retried && /not attached|detached/i.test(err.message || '')) { attached.delete(tabId); await attach(tabId); return sendCapped(tabId, cmds, capMs, expect, true); }
    throw err;
  }
  if (expect && base && !r) {
    const n = await seenInput(tabId, expect.type);
    if (n !== null && n - base[expect.type] < expect.need) throw new Error('input was not delivered to the page (tab hidden or busy); try again');
  }
}
// Type in a few chunks with tiny gaps (visible typing, ~100 ms) and make sure every chunk reached the page.
async function typeChunks(tabId, text, size) {
  await requireTab(tabId);
  const base = await armInput(tabId); const acks = []; let n = 0;
  for (let i = 0; i < text.length; i += size) { acks.push(sendRaw(tabId, 'Input.insertText', { text: text.slice(i, i + size) }).then(() => null, e => e)); n++; await sleep(8); }
  const all = Promise.all(acks), t0 = Date.now(); let r = null;
  while (Date.now() - t0 < 900) {
    const x = await Promise.race([all, sleep(20).then(() => 'tick')]);
    if (x !== 'tick') { r = x; break; }
    if (base) { const c = await seenInput(tabId, 'input'); if (c === null || c - base.input >= n) return; }
  }
  const err = Array.isArray(r) && r.find(Boolean); if (err) throw err;
  if (base) { const c = await seenInput(tabId, 'input'); if (c !== null && c - base.input < n) throw new Error('typed text was not delivered to the page (tab hidden or busy); try again'); }
}
async function mouse(tabId, x, y, o = {}) {
  const button = o.button || 'left', base = { x, y, button, modifiers: o.mods || 0 };
  const cmds = [['Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }]];
  if (!o.hover) {
    cmds.push(['Input.dispatchMouseEvent', { ...base, type: 'mousePressed', clickCount: o.count || 1 }]);
    cmds.push(['Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: o.count || 1 }]);
  }
  await sendCapped(tabId, cmds, 900, o.hover ? { type: 'mousemove', need: 1 } : { type: 'mouseup', need: 1 });
}
// Visual feedback on the page (cursor / ripple / typing box). Switch lives in the panel (storage.local.codexFx).
let fxCache = null;
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.codexFx) fxCache = c.codexFx.newValue !== false; });
async function fxOn() {
  if (fxCache === null) { try { fxCache = (await chrome.storage.local.get('codexFx')).codexFx !== false; } catch { return true; } }
  return fxCache;
}
async function fx(tabId, kind, a, b) {
  if (!(await fxOn())) return 0;
  try { return (await call(tabId, 0, 'fx', kind, a, b)) || 0; } catch { return 0; }
}
// the cursor keeps gliding while the click is sent: wait only half of the travel
async function fxMoveTo(tabId, x, y) { const d = await fx(tabId, 'move', x, y); if (d) await sleep(Math.round(d * 0.5)); }
async function clickTarget(tabId, tgt, o = {}) {
  const xy = /^(\d+),(\d+)$/.exec(tgt);
  if (xy) { await fxMoveTo(tabId, +xy[1], +xy[2]); await mouse(tabId, +xy[1], +xy[2], o); if (!o.hover) void fx(tabId, 'click'); return; }
  const p = pref(tgt); if (!p) throw new Error(`bad target "${tgt}" (use a ref like e12 or x,y)`);
  if (p.frame) { await call(tabId, p.frame, 'domClick', p.ref); return; }
  const l = await call(tabId, 0, 'locate', p.ref);
  if (l.dis && !o.hover) throw new Error(`${tgt} is disabled`);
  if (l.covered && !o.hover) throw new Error(`${tgt} is covered by ${l.covered}. Close the overlay or use js.`);
  await fxMoveTo(tabId, l.x, l.y);
  await mouse(tabId, l.x, l.y, o);
  if (!o.hover) void fx(tabId, 'click');
}

// ---------- steps DSL ----------
async function step(tabId, raw, ctx) {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(raw.trim()); if (!m) throw new Error('empty step');
  const v = m[1].toLowerCase(), rest = m[2];
  const needRef = () => { const t = rest.split(/\s+/)[0]; if (!t) throw new Error(`${v}: missing ref`); return t; };
  switch (v) {
    case 'click': case 'dblclick': case 'rclick': case 'hover': {
      const t = needRef();
      await clickTarget(tabId, t, { count: v === 'dblclick' ? 2 : 1, button: v === 'rclick' ? 'right' : 'left', hover: v === 'hover' });
      if (v !== 'hover') await afterAction(tabId, false); else await sleep(80);
      return;
    }
    case 'type': case 'append': {
      let tgt = null, text = rest;
      const first = rest.split(/\s/)[0];
      if (pref(first)) { tgt = first; text = rest.slice(first.length + 1); }
      if (tgt) {
        const p = pref(tgt);
        if (p.frame) { await call(tabId, p.frame, 'setValue', p.ref, text, v === 'type'); return; }
        const r = await call(tabId, 0, 'prep', p.ref, v === 'type');
        if (r.ro) throw new Error(`${tgt} is read-only`);
        await fxMoveTo(tabId, r.x, r.y); void fx(tabId, 'typeon', p.ref);
      }
      // type letter by letter when the overlay is on, so the user can watch it (short texts only)
      if (text.length > 1 && text.length <= 80 && await fxOn()) await typeChunks(tabId, text, Math.max(1, Math.ceil(text.length / 10)));
      else await sendCapped(tabId, [['Input.insertText', { text }]], 900, { type: 'input', need: 1 });
      void fx(tabId, 'typeoff');
      await sleep(15); return;
    }
    case 'key': {
      for (const k of rest.trim().split(/\s+/)) { await pressKey(tabId, k); }
      await afterAction(tabId, !/enter|return/i.test(rest)); return;
    }
    case 'select': {
      const t = needRef(); const p = pref(t);
      const r = await call(tabId, p.frame, 'selectOpt', p.ref, rest.slice(t.length).trim());
      ctx.notes.push(`selected "${r.picked}"`); await sleep(25); return;
    }
    case 'check': case 'uncheck': {
      const t = needRef(); const p = pref(t);
      const s = await call(tabId, p.frame, 'checkState', p.ref);
      if (s.on !== (v === 'check')) { await clickTarget(tabId, t); await afterAction(tabId, true); }
      return;
    }
    case 'scroll': {
      const a = rest.trim().split(/\s+/);
      if (pref(a[0])) { const p = pref(a[0]); await call(tabId, p.frame, 'scrollTo', null, 0, p.ref); }
      else await call(tabId, 0, 'scrollTo', a[0] || 'down', a[1] ? +a[1] : 0.8);
      await sleep(120); return;
    }
    case 'wait': {
      const r = rest.trim();
      if (/^\d+$/.test(r)) { await sleep(Math.min(+r, 10000)); return; }
      const mm = /^(text|gone|url):([\s\S]+)$/.exec(r); if (!mm) throw new Error('wait: use ms, text:X, gone:X or url:X');
      try { await call(tabId, 0, 'waitFor', { [mm[1]]: mm[2], timeout: 10000 }); }
      catch (e) { if (/timeout/.test(e.message)) throw e; await sleep(400); await call(tabId, 0, 'waitFor', { [mm[1]]: mm[2], timeout: 8000 }); }
      return;
    }
    case 'goto': await navigate(tabId, rest.trim()); return;
    case 'back': case 'forward': case 'reload': await navigate(tabId, v); return;
    case 'upload': {
      const t = needRef(); const p = pref(t); if (p.frame) throw new Error('upload in iframes unsupported');
      const files = rest.slice(t.length).trim().split(';').map(s => s.trim()).filter(Boolean);
      await call(tabId, 0, 'mark', p.ref, true);
      try {
        const doc = await cdp(tabId, 'DOM.getDocument', { depth: 0 });
        const q = await cdp(tabId, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-cx-tmp="1"]' });
        await cdp(tabId, 'DOM.setFileInputFiles', { nodeId: q.nodeId, files });
      } finally { await call(tabId, 0, 'mark', p.ref, false).catch(() => {}); }
      await sleep(150); return;
    }
    case 'dialog': dialogPolicy = /accept/i.test(rest) ? 'accept' : 'dismiss'; return;
    default: throw new Error(`unknown step "${v}"`);
  }
}

// ---------- tools ----------
const H = {
  async _reload() { setTimeout(() => chrome.runtime.reload(), 150); return T('reloading'); },

  // diagnostics (read-only): which window has focus, state of the Codex group and window
  async _state() {
    const w = await chrome.windows.getLastFocused().catch(() => null);
    const g = groupId != null ? await chrome.tabGroups.get(groupId).catch(e => 'ERR ' + e.message) : null;
    const tabs = await chrome.tabs.query({});
    const wins = (await chrome.windows.getAll({ populate: true })).map(x => ({ id: x.id, focused: x.focused, state: x.state, active: (x.tabs.find(t => t.active) || {}).id, n: x.tabs.length, tabs: x.tabs.map(t => [t.id, t.active ? 'A' : '', t.groupId, (t.url || '').slice(0, 28)].join(' ')).slice(0, 6) }));
    return T(JSON.stringify({ wins, focusedWin: w && w.id, codexWin, groupId, group: g && g.title !== undefined ? { title: g.title, color: g.color, win: g.windowId } : g, busy, ctl: [...ctl], inGroup: groupId == null ? [] : tabs.filter(t => t.groupId === groupId).map(t => t.id) }));
  },

  async tabs(p) {
    const a = p.action || 'list';
    if (a === 'list') {
      const all = await chrome.tabs.query({});
      const policy = await accessPolicy();
      const rows = all.filter(t => ctl.has(t.id) && CodexAccess.allowed(policy, t.url, accessSession)).map(t => `${t.id}${t.id === cur ? '*' : ''} ${cut(t.title || '', 50)} · ${short(t.url)}`);
      return T(rows.join('\n') || '(no controlled tabs)');
    }
    if (a === 'new') {
      const t = await newTab('about:blank'); await attach(t.id);
      if (p.url) { await navigate(t.id, p.url); return T(`tab ${t.id}\n` + await snapText(t.id, {})); }
      return T(`tab ${t.id}`);
    }
    if (a === 'show') {
      // Only when the user asks to watch: bring the controlled tab and its window to the front.
      const sid = p.tab ?? cur; if (sid == null || !ctl.has(sid)) throw new Error('no controlled tab to show');
      await requireTab(sid);
      const st = await chrome.tabs.get(sid);
      await chrome.tabs.update(sid, { active: true });
      const win = await chrome.windows.get(st.windowId);
      await chrome.windows.update(st.windowId, win.state === 'minimized' ? { focused: true, state: 'normal' } : { focused: true });
      return T('showing ' + sid);
    }
    if (a === 'adopt') {
      // only the tab the user is looking at right now; no way to pick or enumerate other tabs
      const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!act || !/^https?:/.test(act.url || '')) throw new Error('active tab is not a web page');
      await requireUrl(act.url);
      ctl.add(act.id); cur = act.id; await addToGroup(act.id); await attach(act.id); save();
      return T(`adopted ${act.id} · ${cut(act.title || '', 50)} · ${short(act.url)}`);
    }
    const id = p.tab ?? cur; if (id == null) throw new Error('no tab');
    if (!ctl.has(id)) throw new Error('tab is not controlled');
    await requireTab(id);
    if (a === 'close') {
      const t = await chrome.tabs.get(id);
      if ((await chrome.tabs.query({ windowId: t.windowId })).length <= 1) { // last tab of a window: blank it instead of closing the window
        ctl.delete(id); attached.delete(id); if (cur === id) cur = null;
        try { await chrome.debugger.detach({ tabId: id }); } catch {}
        try { await chrome.tabs.ungroup(id); } catch {}
        await chrome.tabs.update(id, { url: 'about:blank' }); save(); void badge();
        return T('closed ' + id + ' (window kept)');
      }
      await chrome.tabs.remove(id); return T('closed ' + id);
    }
    if (a === 'use') { if (!ctl.has(id)) throw new Error('not controlled'); cur = id; save(); return T('using ' + id); }
    if (a === 'release') { ctl.delete(id); if (cur === id) cur = null; try { await chrome.tabs.ungroup(id); } catch {} try { await chrome.debugger.detach({ tabId: id }); } catch {} save(); return T('released ' + id); }
    throw new Error('bad action');
  },

  async go(p) {
    if (!p.url) throw new Error('url required');
    let t = null;
    if (!p.new) { try { t = await resolveTab(p); } catch {} }
    if (!t) t = await newTab('about:blank');
    await attach(t.id);
    await navigate(t.id, p.url);
    if (p.snap === 'none') { const x = await chrome.tabs.get(t.id); return T(`tab ${t.id} · ${cut(x.title || '', 60)} · ${short(x.url)}`); }
    return T(`tab ${t.id}\n` + await snapText(t.id, { max: p.max }));
  },

  async snap(p) {
    const t = await resolveTab(p, { create: false }); await attach(t.id);
    return T(await snapText(t.id, { scope: p.scope, all: p.all, diff: p.diff, max: p.max }));
  },

  async do(p) {
    const t = await resolveTab(p); await attach(t.id); await ensureVisible(t.id);
    const steps = p.steps || []; if (!steps.length) throw new Error('steps required');
    await ensure(t.id);
    void fx(t.id, 'glow', true);
    const before = (await chrome.tabs.get(t.id)).url;
    const b = bufs.get(t.id); if (b) b.dialog = null;
    const ctx = { notes: [] };
    let i = 0, fail = null;
    for (; i < steps.length; i++) {
      try { await requireTab(t.id); CodexAccess.checkTool(await accessPolicy(), accessSession, 'do', p); await step(t.id, steps[i], ctx); }
      catch (e) { fail = `FAIL step ${i + 1} "${cut(steps[i], 60)}": ${e.message}`; break; }
    }
    await afterAction(t.id, false).catch(() => {});
    void fx(t.id, 'hide');
    const out = [fail || `ok ${steps.length}/${steps.length}`];
    out.push(...ctx.notes);
    const after = await chrome.tabs.get(t.id);
    if (after.url !== before) out.push('→ ' + short(after.url));
    if (b?.dialog) out.push('dialog: ' + b.dialog);
    const mode = p.snap || 'diff';
    if (mode !== 'none') {
      try { out.push(await snapText(t.id, { diff: mode === 'diff', noHead: after.url === before, max: p.max })); }
      catch (e) { out.push('(snapshot failed: ' + e.message + ')'); }
    }
    return { content: [{ type: 'text', text: out.join('\n') }], isError: !!fail };
  },

  async read(p) {
    const t = await resolveTab(p); await ensure(t.id);
    const sc = p.ref ? pref(p.ref) : null;
    const r = await call(t.id, sc ? sc.frame : (p.frame || 0), 'readText', { ref: sc?.ref, max: p.max || 4000, from: p.from || 0, links: !!p.links });
    let s = r.text;
    if (r.from + r.shown < r.total) s += `\n…[${r.from + r.shown}/${r.total} chars; from=${r.from + r.shown} for more]`;
    return T(s || '(no text)');
  },

  async shot(p) {
    const t = await resolveTab(p); await attach(t.id); await ensure(t.id);
    await ensureVisible(t.id);
    let box = null;
    if (p.ref) { const sc = pref(p.ref); box = await call(t.id, sc.frame, 'rectPage', sc.ref); }
    const m = await call(t.id, 0, 'metrics');
    const clip = p.box ? { x: m.sx + p.box[0], y: m.sy + p.box[1], width: p.box[2], height: p.box[3] } : box ? { x: m.sx + box.x, y: m.sy + box.y, width: Math.max(1, box.w), height: Math.max(1, box.h) } : { x: m.sx, y: m.sy, width: m.vw, height: m.vh };
    const w = p.w || 700, scale = Math.min(1, w / clip.width);
    const r = await cdp(t.id, 'Page.captureScreenshot', { format: 'jpeg', quality: p.q || 45, clip: { ...clip, scale }, captureBeyondViewport: true });
    return { content: [{ type: 'text', text: `shot ${Math.round(clip.width * scale)}x${Math.round(clip.height * scale)} (viewport ${m.vw}x${m.vh}; image px × ${(1 / scale).toFixed(2)} = css px)` }, { type: 'image', data: r.data, mimeType: 'image/jpeg' }] };
  },

  async js(p) {
    const t = await resolveTab(p); await attach(t.id);
    const r = await cdp(t.id, 'Runtime.evaluate', { expression: p.code, returnByValue: true, awaitPromise: true, replMode: true, userGesture: true });
    if (r.exceptionDetails) return { content: [{ type: 'text', text: 'error: ' + cut((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0], 300) }], isError: true };
    const v = r.result.value;
    let s = v === undefined ? (r.result.description || String(r.result.type)) : typeof v === 'string' ? v : JSON.stringify(v);
    const max = p.max || 2000;
    if (s.length > max) s = s.slice(0, max) + `…[${s.length} chars]`;
    return T(s);
  },

  async log(p) {
    const t = await resolveTab(p); await attach(t.id);
    const b = bufs.get(t.id); const kind = p.kind || 'console';
    const n = p.n || 30, f = (p.filter || '').toLowerCase();
    if (kind === 'console') {
      let rows = b.con.filter(x => !f || x.toLowerCase().includes(f)).slice(-n);
      if (p.clear) b.con.length = 0;
      return T(rows.join('\n') || '(empty — capture starts when the tab is first used)');
    }
    if (p.body) {
      const e = b.net.find(x => x.id === p.body); if (!e) throw new Error('unknown request id');
      const r = await cdp(t.id, 'Network.getResponseBody', { requestId: e.rid });
      return T(cut(r.base64Encoded ? '(binary)' : r.body, p.max || 3000));
    }
    const skip = /^(image|font|stylesheet|media|other|ping)$/;
    let rows = b.net.filter(e => (p.all || !skip.test(e.type)) && (!f || e.url.toLowerCase().includes(f))).slice(-n);
    const s = rows.map(e => `${e.id} ${e.method} ${e.status || '…'} ${e.type} ${redact(e.url)}${e.size ? ' ' + (e.size > 1024 ? Math.round(e.size / 1024) + 'k' : e.size + 'b') : ''}`).join('\n');
    if (p.clear) { b.net.length = 0; b.map.clear(); }
    return T(s || '(no requests)');
  },
};
