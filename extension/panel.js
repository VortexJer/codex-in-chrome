// Live part of the panel: logo colour (green = on), pause button, controlled tabs and activity.
document.getElementById('lp').setAttribute('d', LOGO_PATH);
const g = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let winState = null;
async function refresh() {
  let s; try { s = await chrome.runtime.sendMessage({ t: 'state' }); } catch { return; }
  if (!s) return;
  const active = s.mode === 'work';
  document.body.className = s.mode;
  g('status').textContent = { work: 'Debugging', wait: 'Idle', pause: 'Paused', off: 'No session' }[s.mode];
  g('status').className = s.mode;
  g('hint').textContent = s.paused ? 'Paused: Codex cannot use the browser.'
    : !s.connected ? 'The local hub starts automatically when Codex connects.'
    : s.clients && !s.granted ? 'A Codex session is connected. Save authorization to allow access.'
    : active ? 'Codex is debugging a tab now.'
    : s.clients ? 'Codex is connected and idle. No tab is being debugged.'
    : 'No Codex session is open. Saved permissions apply when a session connects.';
  g('toggle').textContent = s.paused ? 'Resume' : 'Pause';
  winState = s.winState;
  g('winbtn').disabled = !s.winState;
  g('winbtn').textContent = s.winState && s.winState !== 'minimized' ? 'Hide Codex window' : 'Show Codex window';
  g('tabs').innerHTML = s.tabs.length ? s.tabs.map(t => `<li><div class="t">${t.cur ? '● ' : ''}${esc(t.title || 'untitled')}<small>${esc(t.url)}</small></div><button data-id="${t.id}">Release</button></li>`).join('') : '<li class="empty">None</li>';
  g('log').innerHTML = s.log.length ? s.log.slice().reverse().map(l => `<li class="${l.err ? 'e' : ''}">${esc(l.time)} · ${esc(l.what)}${l.err ? ' — ' + esc(l.err) : ''}</li>`).join('') : '<li class="empty">No activity</li>';
}
g('toggle').onclick = async () => { await chrome.runtime.sendMessage({ t: 'pause' }); refresh(); };
g('tabs').onclick = async e => { const b = e.target.closest('button[data-id]'); if (b) { await chrome.runtime.sendMessage({ t: 'release', id: +b.dataset.id }); refresh(); } };
refresh(); setInterval(refresh, 1000);

const fxBox = document.getElementById('fx');
chrome.storage.local.get('codexFx').then(v => { fxBox.checked = v.codexFx !== false; });
fxBox.onchange = () => chrome.storage.local.set({ codexFx: fxBox.checked });

g('winbtn').onclick = async () => { await chrome.runtime.sendMessage({ t: winState && winState !== 'minimized' ? 'hidewin' : 'showwin' }); refresh(); };
