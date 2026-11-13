const $ = id => document.getElementById(id);
const show = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'error' : ''; };
let session;
async function init() {
  const state = await chrome.storage.session.get('codexAccessSession');
  session = state.codexAccessSession || crypto.randomUUID();
  if (!state.codexAccessSession) await chrome.storage.session.set({codexAccessSession:session});
  const {codexAccess:p} = await chrome.storage.local.get('codexAccess');
  if (p) { $('mode').value=p.mode || 'read'; $('scope').value=p.scope || 'sites'; $('sites').value=(p.sites || []).join('\n'); $('duration').value=p.duration || '120'; }
  $('sites-box').hidden=$('scope').value === 'all';
  await status();
}
async function status() {
  const {codexAccess:p} = await chrome.storage.local.get('codexAccess');
  const {paused} = await chrome.storage.session.get('paused');
  const on = CodexAccess.enabled(p,session) && !paused;
  $('perm').textContent=CodexAccess.enabled(p,session) ? (p.mode === 'control' ? 'Guardado: leer e interactuar' : 'Guardado: solo lectura') + ' · ' + (p.scope === 'all' ? 'todos los sitios' : (p.sites||[]).length + ' sitio(s)') + ' · ' + (p.duration === 'manual' ? 'permanente' : p.duration === 'session' ? 'hasta cerrar Chrome' : p.duration + ' min') : 'Sin permisos concedidos';
  $('perm').className=CodexAccess.enabled(p,session)?'permline ok':'permline';
  $('allow').textContent=on?'Guardar autorización':'Autorizar acceso';
  $('stop').disabled=!p?.enabled;
}
$('scope').onchange=() => { $('sites-box').hidden=$('scope').value === 'all'; };
$('settings').onsubmit=async event => {
  event.preventDefault();
  try {
    const scope=$('scope').value, duration=$('duration').value;
    const sites=scope === 'sites' ? [...new Set($('sites').value.split(/[\n,]+/).map(v=>v.trim()).filter(Boolean).map(CodexAccess.origin))] : [];
    if (scope === 'sites' && !sites.length) throw new Error('Indica al menos un sitio o elige Todos los sitios web.');
    const policy={enabled:true,mode:$('mode').value,scope,sites,duration,expiresAt:/^\d+$/.test(duration)?Date.now()+Number(duration)*60000:null,session:duration==='session'?session:null};
    await chrome.storage.session.set({paused:false});
    await chrome.storage.local.set({codexAccess:policy});
    show('Autorización guardada. Puedes detenerla aquí cuando quieras.'); await status();
  } catch(error) {show(error.message,true);}
};
$('stop').onclick=async () => {
  const {codexAccess:p={}} = await chrome.storage.local.get('codexAccess');
  await chrome.storage.local.set({codexAccess:{...p,enabled:false}});
  await chrome.storage.session.set({paused:true});
  show('Acceso revocado. Codex ya no puede operar las pestañas.'); await status();
};
$('expand')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(() => { void status(); });
void init();
