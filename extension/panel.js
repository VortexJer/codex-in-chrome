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
  g('status').textContent = { work: 'Depurando', wait: 'En espera', pause: 'En pausa', off: 'Sin sesión' }[s.mode];
  g('status').className = s.mode;
  g('hint').textContent = s.paused ? 'En pausa: Codex no puede usar el navegador.'
    : !s.connected ? 'Sin conexión con el hub: se inicia solo cuando Codex arranca.'
    : s.clients && !s.granted ? 'Hay una sesión de Codex, pero aún no le has dado permisos.'
    : active ? 'Codex está depurando una pestaña ahora mismo.'
    : s.clients ? 'Codex conectado y a la espera. Ninguna pestaña se está depurando.'
    : 'Ninguna sesión de Codex abierta. Los permisos guardados se aplicarán cuando abra una.';
  g('toggle').textContent = s.paused ? 'Reanudar' : 'Pausar';
  winState = s.winState;
  g('winbtn').disabled = !s.winState;
  g('winbtn').textContent = s.winState && s.winState !== 'minimized' ? 'Ocultar ventana de Codex' : 'Ver ventana de Codex';
  g('tabs').innerHTML = s.tabs.length ? s.tabs.map(t => `<li><div class="t">${t.cur ? '● ' : ''}${esc(t.title || 'sin título')}<small>${esc(t.url)}</small></div><button data-id="${t.id}">Soltar</button></li>`).join('') : '<li class="empty">Ninguna</li>';
  g('log').innerHTML = s.log.length ? s.log.slice().reverse().map(l => `<li class="${l.err ? 'e' : ''}">${esc(l.time)} · ${esc(l.what)}${l.err ? ' — ' + esc(l.err) : ''}</li>`).join('') : '<li class="empty">Sin actividad</li>';
}
g('toggle').onclick = async () => { await chrome.runtime.sendMessage({ t: 'pause' }); refresh(); };
g('tabs').onclick = async e => { const b = e.target.closest('button[data-id]'); if (b) { await chrome.runtime.sendMessage({ t: 'release', id: +b.dataset.id }); refresh(); } };
refresh(); setInterval(refresh, 1000);

const fxBox = document.getElementById('fx');
chrome.storage.local.get('codexFx').then(v => { fxBox.checked = v.codexFx !== false; });
fxBox.onchange = () => chrome.storage.local.set({ codexFx: fxBox.checked });

g('winbtn').onclick = async () => { await chrome.runtime.sendMessage({ t: winState && winState !== 'minimized' ? 'hidewin' : 'showwin' }); refresh(); };
