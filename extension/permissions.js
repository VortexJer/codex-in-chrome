const $ = id => document.getElementById(id);
const show = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'error' : ''; };
let session;
async function init() {
  const state = await chrome.storage.session.get('codexAccessSession');
  session = state.codexAccessSession || crypto.randomUUID();
  if (!state.codexAccessSession) await chrome.storage.session.set({codexAccessSession:session});
  const {codexAccess:p} = await chrome.storage.local.get('codexAccess');
  if (p) { $('mode').value=p.mode || 'read'; $('scope').value=p.scope || 'sites'; $('sites').value=(p.sites || []).join('\n'); $('duration').value=p.duration || 'manual'; }
  $('sites-box').hidden=$('scope').value === 'all';
  await status();
}
async function status() {
  const {codexAccess:p} = await chrome.storage.local.get('codexAccess');
  $('perm').textContent=CodexAccess.enabled(p,session) ? (p.mode === 'control' ? 'Saved: read and interact' : 'Saved: read only') + ' · ' + (p.scope === 'all' ? 'all websites' : (p.sites||[]).length + ' site(s)') + ' · ' + (p.duration === 'manual' ? 'permanent' : p.duration === 'session' ? 'until Chrome closes' : p.duration + ' min') : 'No permissions granted';
  $('perm').className=CodexAccess.enabled(p,session)?'permline ok':'permline';
  $('allow').textContent='Save authorization';
  $('stop').disabled=!p?.enabled;
}
$('scope').onchange=() => { $('sites-box').hidden=$('scope').value === 'all'; };
$('settings').onsubmit=async event => {
  event.preventDefault();
  try {
    const scope=$('scope').value, duration=$('duration').value;
    const sites=scope === 'sites' ? [...new Set($('sites').value.split(/[\n,]+/).map(v=>v.trim()).filter(Boolean).map(CodexAccess.origin))] : [];
    if (scope === 'sites' && !sites.length) throw new Error('Enter at least one site or choose All websites.');
    const policy={enabled:true,mode:$('mode').value,scope,sites,duration,expiresAt:/^\d+$/.test(duration)?Date.now()+Number(duration)*60000:null,session:duration==='session'?session:null};
    await chrome.storage.session.set({paused:false});
    await chrome.storage.local.set({codexAccess:policy});
    show('Authorization saved. You can stop and revoke it here at any time.'); await status();
  } catch(error) {show(error.message,true);}
};
$('stop').onclick=async () => {
  const {codexAccess:p={}} = await chrome.storage.local.get('codexAccess');
  await chrome.storage.local.set({codexAccess:{...p,enabled:false}});
  await chrome.storage.session.set({paused:true});
  show('Access revoked. Codex can no longer operate the tabs.'); await status();
};
$('expand')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(() => { void status(); });
void init();
