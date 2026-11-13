// Codex in Chrome - page library (isolated world, runs in every frame).
(() => {
  if (window.__cx && window.__cx.v >= 5) return;
  const ids = new WeakMap(), byId = new Map();
  let n = 0, prev = null, prevUrl = '', prevY = 0, prevScope = '';

  const txt = s => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);
  const ref = el => {
    let r = ids.get(el);
    if (!r) { r = 'e' + (++n); ids.set(el, r); byId.set(r, new WeakRef(el)); }
    return r;
  };
  const get = r => {
    const el = byId.get(r)?.deref();
    return el && el.isConnected ? el : null;
  };

  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'svg', 'canvas', 'iframe']);
  const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'switch', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem', 'listbox']);
  const LAND = { nav: 'nav', main: 'main', aside: 'aside', footer: 'footer', header: 'header', dialog: 'dialog', form: 'form',
    navigation: 'nav', banner: 'header', contentinfo: 'footer', complementary: 'aside', alertdialog: 'dialog', search: 'search' };

  const sensitive = el => {
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (t === 'password') return true;
    const a = (el.getAttribute('autocomplete') || '').toLowerCase();
    return /password|one-time-code|cc-/.test(a);
  };

  const roleOf = el => {
    const r = el.getAttribute('role');
    if (r) return r.split(' ')[0];
    const t = el.localName;
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') {
      const ty = (el.type || 'text').toLowerCase();
      if (ty === 'hidden') return '';
      if (ty === 'checkbox' || ty === 'radio') return ty;
      if (['button', 'submit', 'reset', 'image', 'file'].includes(ty)) return 'button';
      if (ty === 'range') return 'slider';
      if (ty === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (LAND[t] && t !== 'header' && t !== 'footer') return t;
    return '';
  };

  const labelText = el => {
    const l = el.labels && el.labels[0];
    if (!l) return '';
    const k = l.cloneNode(true);
    k.querySelectorAll('select,input,textarea,button,option').forEach(x => x.remove());
    return txt(k.textContent);
  };

  const nameOf = (el, role) => {
    let s = el.getAttribute('aria-label');
    if (s && txt(s)) return cut(txt(s), 80);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(i => document.getElementById(i)).filter(Boolean).map(e => txt(e.innerText || e.textContent)).join(' ');
      if (t) return cut(t, 80);
    }
    const tag = el.localName;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const l = labelText(el);
      if (l) return cut(l, 80);
      s = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
      if (role === 'button' && el.value && !sensitive(el)) return cut(txt(el.value), 80);
      return cut(txt(s), 80);
    }
    let t = txt(el.innerText || el.textContent);
    if (!t) {
      const img = el.querySelector('img[alt],svg title');
      t = img ? txt(img.getAttribute?.('alt') || img.textContent) : '';
    }
    if (!t) t = txt(el.getAttribute('title') || el.getAttribute('alt') || '');
    return cut(t, 80);
  };

  const stateOf = (el, role) => {
    let s = '';
    const tag = el.localName;
    const ac = el.getAttribute('aria-checked');
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox') {
      const on = tag === 'input' ? el.checked : ac === 'true';
      s += on ? ' [x]' : ' [ ]';
    }
    if (tag === 'select') {
      const o = el.selectedOptions && el.selectedOptions[0];
      if (o) s += ` ="${cut(txt(o.textContent), 40)}"`;
    } else if ((tag === 'input' || tag === 'textarea') && (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'slider' || role === 'spinbutton')) {
      if (el.value) s += sensitive(el) ? ' ="•••"' : ` ="${cut(txt(el.value), 40)}"`;
    } else if (el.isContentEditable && role === 'textbox') {
      const v = txt(el.textContent); if (v) s += ` ="${cut(v, 40)}"`;
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s += ' disabled';
    const ex = el.getAttribute('aria-expanded'); if (ex) s += ex === 'true' ? ' open' : ' closed';
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-current') === 'page') s += ' sel';
    if (el.required || el.getAttribute('aria-required') === 'true') s += ' *';
    if (el.getAttribute('aria-invalid') === 'true') s += ' invalid';
    return s;
  };

  const hrefOf = el => {
    if (el.localName !== 'a') return '';
    try {
      const u = new URL(el.href, location.href);
      let h = u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname;
      if (u.hash && u.origin === location.origin && u.pathname === location.pathname) h = u.hash;
      return ' →' + cut(h, 60);
    } catch { return ''; }
  };

  const isInteractive = (el, role, inInter) => {
    if (ROLES.has(role)) return true;
    if (role === 'heading') return false;
    if (el.hasAttribute('onclick') || el.hasAttribute('jsaction')) return true;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && +ti >= 0 && el !== document.body) return true;
    if (el.localName === 'label' && el.control && !el.control.offsetParent) return false;
    if (!inInter && /^(div|span|li|img|td|i|p)$/.test(el.localName)) {
      const cs = getComputedStyle(el);
      if (cs.cursor === 'pointer') {
        const pc = el.parentElement && getComputedStyle(el.parentElement).cursor;
        if (pc !== 'pointer') return true;
      }
    }
    return false;
  };

  const rectOf = el => {
    let r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0 && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') && el.labels && el.labels[0]) {
      r = el.labels[0].getBoundingClientRect();
    }
    return r;
  };

  function findModal() {
    const c = document.querySelectorAll('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]');
    for (let i = c.length - 1; i >= 0; i--) {
      const r = c[i].getBoundingClientRect();
      if (r.width > 50 && r.height > 50 && getComputedStyle(c[i]).visibility !== 'hidden') return c[i];
    }
    return null;
  }

  // ---- snapshot ----
  function snapshot(o = {}) {
    const full = !!o.all, vh = innerHeight, vw = innerWidth;
    let root = document.body || document.documentElement, scopeKey = '', modal = false;
    if (o.scope) {
      const e = get(o.scope);
      if (!e) return { err: 'stale ref ' + o.scope };
      root = e; scopeKey = o.scope;
    } else {
      const m = findModal();
      if (m) { root = m; modal = true; scopeKey = 'modal'; }
    }
    const lines = [], keys = [];
    let above = 0, below = 0, budget = Date.now() + 1800;
    const pending = []; let depth = 0;
    const emit = (key, line) => {
      while (pending.length) { const p = pending.shift(); lines.push(' '.repeat(Math.max(0, depth - 1)) + p); keys.push('L:' + p + lines.length); }
      lines.push(' '.repeat(depth) + line); keys.push(key);
    };
    const inview = r => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;

    function visit(el, inInter, hadLandmark) {
      if (Date.now() > budget) return;
      const tag = el.localName;
      if (SKIP.has(tag) || el.hidden || el.inert || el.getAttribute('aria-hidden') === 'true') return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const role = roleOf(el);
      const land = LAND[role] || LAND[tag];
      let pushedLand = false;
      if (land && el !== root && (!['header', 'footer'].includes(tag) || !el.closest('article,section,main'))) {
        const nm = el.getAttribute('aria-label');
        pending.push('[' + land + (nm ? ' ' + cut(txt(nm), 30) : '') + ']');
        depth++; pushedLand = true;
      }
      let inter = false;
      if (cs.visibility !== 'hidden') {
        if (role === 'heading' || /^h[1-6]$/.test(tag)) {
          const t = cut(txt(el.innerText || el.textContent), 100);
          if (t) {
            const r = el.getBoundingClientRect();
            if (r.height > 0) {
              if (full || inview(r)) { const lv = +(tag[1]) || +(el.getAttribute('aria-level')) || 2; emit('h:' + t, '#'.repeat(lv) + ' ' + t); }
              else if (r.top >= vh) below++; else above++;
            }
          }
        } else if (el.matches('[role=alert],[role=status],[aria-live=assertive],[aria-live=polite]')) {
          const t = cut(txt(el.innerText || el.textContent), 160);
          if (t && el.getBoundingClientRect().height > 0) emit('!:' + t, '! ' + t);
        } else if (isInteractive(el, role, inInter)) {
          const r = rectOf(el);
          if (r.width > 0 || r.height > 0) {
            if (full || inview(r)) {
              const rl = role || (el.localName === 'a' ? 'link' : 'click');
              const name = nameOf(el, role);
              const line = `${ref(el)} ${rl}${name ? ' "' + name + '"' : ''}${stateOf(el, role)}${hrefOf(el)}`;
              emit(ref(el), line);
            } else if (r.top >= vh) below++; else above++;
          }
          inter = true;
        } else if (/(^|\s)(error|invalid|alert|warning)[-_a-z]*(\s|$)/i.test(el.className?.toString?.() || '') && el.children.length < 3) {
          const t = cut(txt(el.innerText || ''), 160);
          if (t && t.length > 2 && el.getBoundingClientRect().height > 0) emit('!:' + t, '! ' + t);
        }
      }
      if (tag === 'select') { if (pushedLand) depth--; return; }
      const sr = el.shadowRoot;
      if (sr) for (const c of sr.children) visit(c, inInter || inter);
      for (const c of el.children) visit(c, inInter || inter);
      if (pushedLand) { depth--; pending.length = 0; }
    }
    if (root === document.body || root === document.documentElement) for (const c of root.children) visit(c, false);
    else visit(root, false);

    const url = location.href, y = scrollY;
    const sh = document.documentElement.scrollHeight, pct = sh > vh ? Math.round(100 * (y + vh) / sh) : 100;
    let foot = '';
    if (below || above) foot = `(${above ? '↑' + above + ' ' : ''}${below ? '↓' + below + ' more offscreen' : ''})`.replace(/ \)/, ')');
    foot += (foot ? ' ' : '') + `scroll ${pct}%`;

    // diff
    const cur = new Map(); keys.forEach((k, i) => cur.set(k, lines[i]));
    let text, mode = 'full';
    const canDiff = o.diff && prev && prevUrl === url && prevScope === scopeKey && Math.abs(prevY - y) < 8;
    if (canDiff) {
      const add = [], chg = [], rem = [];
      cur.forEach((l, k) => { if (k.startsWith('L:')) return; if (!prev.has(k)) add.push('+ ' + l.trim()); else if (prev.get(k) !== l) chg.push('~ ' + l.trim()); });
      prev.forEach((l, k) => { if (!k.startsWith('L:') && !k.startsWith('h:') && !k.startsWith('!:') && !cur.has(k)) rem.push('- ' + k); });
      const total = add.length + chg.length + rem.length;
      if (total <= Math.max(6, cur.size * 0.6)) {
        mode = 'diff';
        text = total ? [...rem, ...chg, ...add].join('\n') : '(no change)';
      }
    }
    if (mode === 'full') text = (modal ? '[modal]\n' : '') + lines.join('\n');
    prev = cur; prevUrl = url; prevY = y; prevScope = scopeKey;
    return { text, mode, foot, url, title: document.title, n: lines.length, frames: document.querySelectorAll('iframe').length };
  }

  // ---- text reader ----
  const BLOCK = /^(p|div|section|article|li|ul|ol|tr|table|h[1-6]|br|blockquote|pre|form|header|footer|main|dd|dt|dl|figure|figcaption)$/;
  function readText(o = {}) {
    let root = o.ref ? get(o.ref) : null;
    if (o.ref && !root) return { err: 'stale ref ' + o.ref };
    if (!root) {
      root = document.querySelector('main,[role=main],article') || document.body;
      const alt = document.querySelector('article');
      if (alt && alt.innerText.length > (root.innerText || '').length * 0.5) root = alt;
    }
    const out = []; const links = !!o.links;
    const walk = (nd) => {
      if (nd.nodeType === 3) { const t = nd.textContent.replace(/\s+/g, ' '); if (t.trim()) out.push(t); return; }
      if (nd.nodeType !== 1) return;
      const tag = nd.localName;
      if (SKIP.has(tag) && tag !== 'iframe') return;
      if (!o.ref && /^(nav|footer|aside)$/.test(tag)) return;
      if (nd.hidden || nd.getAttribute('aria-hidden') === 'true') return;
      const cs = getComputedStyle(nd);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const blk = BLOCK.test(tag) || cs.display === 'block' || cs.display === 'flex' && false;
      if (/^h[1-6]$/.test(tag)) out.push('\n' + '#'.repeat(+tag[1]) + ' ');
      else if (tag === 'li') out.push('\n- ');
      else if (blk) out.push('\n');
      if (tag === 'input' || tag === 'textarea') { if (nd.value && !sensitive(nd)) out.push(`[${cut(nd.value, 60)}]`); return; }
      if (tag === 'img') { const a = nd.getAttribute('alt'); if (a) out.push(`[img ${cut(a, 50)}]`); return; }
      const sr = nd.shadowRoot; if (sr) sr.childNodes.forEach(walk);
      const start = out.length;
      nd.childNodes.forEach(walk);
      if (links && tag === 'a' && nd.href && out.length > start) { try { const u = new URL(nd.href); out.push(` (${u.origin === location.origin ? u.pathname + u.search : u.href})`); } catch {} }
      if (tag === 'td' || tag === 'th') out.push(' | ');
      if (blk && !/^h[1-6]$/.test(tag)) out.push('\n');
    };
    walk(root);
    let t = out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const from = o.from || 0, max = o.max || 4000;
    const total = t.length;
    t = t.slice(from, from + max);
    return { text: t, total, from, shown: t.length };
  }

  // ---- element actions ----
  function describe(e) {
    if (!e) return 'nothing';
    const nm = cut(txt(e.innerText || e.getAttribute('aria-label') || e.id || ''), 30);
    return e.localName + (nm ? ` "${nm}"` : '');
  }
  function locate(r, opt = {}) {
    const el = get(r);
    if (!el) return { err: `stale ref ${r} (page changed; call snap)` };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rc = rectOf(el);
    if (rc.width <= 0 && rc.height <= 0) return { err: `${r} has no visible box` };
    const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2);
    const root = el.getRootNode();
    let hit = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
    let covered = '';
    const target = (el.labels && rc !== el.getBoundingClientRect() && el.labels[0]) || el;
    if (hit && !(target.contains(hit) || hit.contains(target) || (hit.getRootNode() !== document && hit.getRootNode().host && target.contains(hit.getRootNode().host)))) covered = describe(hit);
    return { x, y, covered, dis: !!(el.disabled || el.getAttribute('aria-disabled') === 'true') };
  }
  function domClick(r) {
    const el = get(r); if (!el) return { err: 'stale ref ' + r };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click(); return { ok: 1 };
  }
  function prep(r, clear) { // focus + select contents, before CDP insertText
    const el = get(r); if (!el) return { err: `stale ref ${r}` };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus();
    if (el.isContentEditable) {
      const rg = document.createRange(); rg.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); if (clear) s.addRange(rg); else { rg.collapse(false); s.addRange(rg); }
    } else if (el.select) {
      if (clear) el.select(); else { const l = el.value.length; try { el.setSelectionRange(l, l); } catch {} }
    }
    const pr = rectOf(el);
    return { ok: 1, tag: el.localName, type: el.type || '', ro: !!el.readOnly, x: Math.round(pr.left + pr.width / 2), y: Math.round(pr.top + pr.height / 2) };
  }
  function setValue(r, text, clear = true) { // fallback w/o CDP (iframes)
    const el = get(r); if (!el) return { err: 'stale ref ' + r };
    el.focus();
    const v = clear ? text : (el.value || '') + text;
    if (el.isContentEditable) { el.textContent = v; }
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: 1 };
  }
  function selectOpt(r, val) {
    const el = get(r); if (!el || el.localName !== 'select') return { err: `${r} is not a select` };
    const v = val.toLowerCase();
    const opts = [...el.options];
    const o = opts.find(o => o.value === val) || opts.find(o => txt(o.textContent).toLowerCase() === v) || opts.find(o => txt(o.textContent).toLowerCase().includes(v));
    if (!o) return { err: `no option "${val}". Options: ` + opts.slice(0, 12).map(o => cut(txt(o.textContent), 25)).join(' | ') };
    el.value = o.value;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: 1, picked: txt(o.textContent) };
  }
  function checkState(r) {
    const el = get(r); if (!el) return { err: 'stale ref ' + r };
    return { on: el.localName === 'input' ? el.checked : el.getAttribute('aria-checked') === 'true' };
  }
  function scrollTo(dir, amt = 0.8, r) {
    if (r) { const el = get(r); if (!el) return { err: 'stale ref ' + r }; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return { ok: 1 }; }
    const h = innerHeight;
    if (dir === 'top') scrollTo2(0);
    else if (dir === 'bottom') scrollTo2(1e9);
    else {
      // scroll the main window; if it can't move, try the largest scrollable container
      const before = scrollY;
      scrollBy({ top: (dir === 'up' ? -1 : 1) * h * amt, behavior: 'instant' });
      if (Math.abs(scrollY - before) < 2) {
        let best = null, bs = 0;
        document.querySelectorAll('*').forEach(e => { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20) { const a = e.clientWidth * e.clientHeight; if (a > bs) { bs = a; best = e; } } });
        if (best) best.scrollBy({ top: (dir === 'up' ? -1 : 1) * best.clientHeight * amt, behavior: 'instant' });
      }
    }
    return { ok: 1 };
  }
  function scrollTo2(y) { scrollTo({ top: y, behavior: 'instant' }); }
  async function waitFor(o) {
    const end = Date.now() + (o.timeout || 10000);
    const has = t => (document.body?.innerText || '').toLowerCase().includes(t.toLowerCase());
    while (Date.now() < end) {
      if (o.text && has(o.text)) return { ok: 1 };
      if (o.gone && !has(o.gone)) return { ok: 1 };
      if (o.url && location.href.includes(o.url)) return { ok: 1 };
      await new Promise(r => setTimeout(r, 120));
    }
    return { err: 'timeout waiting for ' + (o.text ? 'text:' + o.text : o.gone ? 'gone:' + o.gone : 'url:' + o.url) };
  }
  function settle(quiet = 200, max = 1500) {
    return new Promise(res => {
      let t = setTimeout(done, quiet), hard = setTimeout(done, max);
      const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, quiet); });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      function done() { mo.disconnect(); clearTimeout(t); clearTimeout(hard); res(1); }
    });
  }
  function mark(r, on) { const el = get(r); if (!el) return 0; if (on) el.setAttribute('data-cx-tmp', '1'); else el.removeAttribute('data-cx-tmp'); return 1; }
  function vis() { return document.visibilityState; }
  function metrics() { return { vw: innerWidth, vh: innerHeight, sx: scrollX, sy: scrollY, dpr: devicePixelRatio }; }
  function rectPage(r) {
    const el = get(r); if (!el) return { err: 'stale ref ' + r };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = rectOf(el); return { x: b.left, y: b.top, w: b.width, h: b.height };
  }

  // ---- visual feedback: fake cursor, click ripple, typing box, page glow (closed shadow DOM, never intercepts input) ----
  let fxHost = null, fxRoot = null, fxCur = null, fxLast = null, fxTimer = 0, fxBox = null, fxGlow = null, fxOff = 0;
  const FX_CSS = `
    #glow{position:fixed;inset:0;opacity:0;transition:opacity .4s;box-shadow:inset 0 0 0 1px rgba(98,184,189,.5),inset 0 0 28px rgba(98,184,189,.12)}
    #glow.on{opacity:1}
    #cur{position:fixed;left:0;top:0;opacity:0;transition:transform var(--d,.3s) cubic-bezier(.22,.8,.25,1),opacity .25s;will-change:transform}
    #cur{--fill:#62b8bd;--stroke:#fff}
    #cur svg{display:block;width:19px;height:23px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.22))}
    #cur path{fill:var(--fill);stroke:var(--stroke);stroke-width:.9;stroke-linejoin:round;transition:fill .18s,stroke .18s}
    #cur b{position:absolute;left:13px;top:19px;font:500 10px/1 system-ui,Segoe UI,sans-serif;color:#e9f4f5;background:rgba(22,26,30,.78);padding:3px 7px;border-radius:7px;white-space:nowrap;border:1px solid rgba(255,255,255,.14)}
    #box{position:fixed;opacity:0;border:1.5px solid #62b8bd;border-radius:6px;transition:opacity .15s;pointer-events:none;box-shadow:0 0 0 3px rgba(98,184,189,.14)}
    #box.on{opacity:1}
    #box span{position:absolute;left:-1px;top:-20px;font:500 10px/1 system-ui,Segoe UI,sans-serif;color:#e9f4f5;background:rgba(22,26,30,.78);padding:3px 7px;border-radius:6px;white-space:nowrap;border:1px solid rgba(255,255,255,.14)}
    #box.below span{top:auto;bottom:-20px}
    .rp{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border:1.5px solid var(--rp,#62b8bd);border-radius:50%;animation:rp .45s ease-out forwards}
    @keyframes rp{from{transform:scale(.25);opacity:.9}to{transform:scale(1.7);opacity:0}}`;
  // What is under the pointer? Walk up to the first (mostly) opaque background colour; null if it is an image/gradient.
  function fxBgAt(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const cs = getComputedStyle(el), c = cs.backgroundColor || '';
      let n = (c.match(/-?[0-9.]+/g) || []).map(Number);
      if (c.startsWith('color(')) n = n.map((v, i) => (i < 3 ? v * 255 : v));
      if (n.length >= 3) { const a = n.length > 3 ? n[3] : 1; if (a > 0.5) return [n[0], n[1], n[2]]; }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    }
    return [255, 255, 255];
  }
  const fxLum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const FX_TURQ = [98, 184, 189];
  // white outline, black on light backgrounds; greyish when the cursor colour would vanish into the background
  function fxColors(x, y) {
    // sample the tip, the body and the lower part of the arrow plus the "Codex" label: the cursor covers all of them
    const pts = [[x + 2, y + 3], [x + 6, y + 12], [x + 11, y + 17], [x + 38, y + 31]];
    const bgs = pts.map(([px, py]) => fxBgAt(px, py)).filter(Boolean);
    if (!bgs.length) return { stroke: '#fff', fill: '#62b8bd' };
    const lum = bgs.reduce((t, c) => t + fxLum(c), 0) / bgs.length;
    const near = c => Math.hypot(c[0] - FX_TURQ[0], c[1] - FX_TURQ[1], c[2] - FX_TURQ[2]) < 80;
    const grey = bgs.some(near);
    return { stroke: lum > 0.45 ? '#111' : '#fff', fill: grey ? '#9aa1a6' : '#62b8bd' };
  }
  function fxInit() {
    if (window !== window.top) return false;
    if (fxHost && fxHost.isConnected) return true;
    fxHost = document.createElement('div');
    fxHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    fxRoot = fxHost.attachShadow({ mode: 'closed' });
    fxRoot.innerHTML = '<style>' + FX_CSS + '</style><div id="glow"></div><div id="box"><span>✎ escribiendo…</span></div>' +
      '<div id="cur"><svg viewBox="0 0 22 26"><path d="M2 1 L2 20 L7 15.5 L10.6 23.5 L13.6 22.2 L10 14.4 L16.5 14 Z"/></svg><b>Codex</b></div>';
    fxGlow = fxRoot.getElementById('glow'); fxBox = fxRoot.getElementById('box'); fxCur = fxRoot.getElementById('cur');
    document.documentElement.appendChild(fxHost);
    return true;
  }
  function fxArm() { clearTimeout(fxTimer); fxTimer = setTimeout(() => { if (fxCur) fxCur.style.opacity = '0'; fxLast = null; }, 3500); }
  function fx(kind, a, b) {
    if (!fxInit()) return 0;
    if (kind === 'move') {
      const from = fxLast || { x: a - 90, y: b - 70 };
      const d = Math.max(70, Math.min(170, Math.round(Math.hypot(a - from.x, b - from.y) * 0.28)));
      if (!fxLast) { fxCur.style.transition = 'none'; fxCur.style.transform = 'translate(' + (from.x - 2) + 'px,' + (from.y - 1) + 'px)'; fxCur.getBoundingClientRect(); fxCur.style.transition = ''; }
      fxCur.style.setProperty('--d', d + 'ms'); fxCur.style.opacity = '1';
      fxCur.style.transform = 'translate(' + (a - 2) + 'px,' + (b - 1) + 'px)';
      const col = fxColors(a, b);
      fxCur.style.setProperty('--stroke', col.stroke); fxCur.style.setProperty('--fill', col.fill);
      fxLast = { x: a, y: b, fill: col.fill }; fxArm(); return d;
    }
    if (kind === 'click') {
      if (!fxLast) return 0;
      const r = document.createElement('div'); r.className = 'rp'; r.style.left = fxLast.x + 'px'; r.style.top = fxLast.y + 'px'; r.style.setProperty('--rp', fxLast.fill || '#62b8bd');
      fxRoot.appendChild(r); setTimeout(() => r.remove(), 600); fxArm(); return 1;
    }
    if (kind === 'typeon') {
      const el = get(a); if (!el) return 0;
      const rc = rectOf(el);
      fxBox.style.left = rc.left - 3 + 'px'; fxBox.style.top = rc.top - 3 + 'px'; fxBox.style.width = rc.width + 2 + 'px'; fxBox.style.height = rc.height + 2 + 'px';
      fxBox.classList.toggle('below', rc.top < 30); fxBox.classList.add('on'); clearTimeout(fxOff); fxArm(); return 1;
    }
    if (kind === 'typeoff') { clearTimeout(fxOff); fxOff = setTimeout(() => fxBox.classList.remove('on'), 700); return 1; }
    if (kind === 'glow') { fxGlow.classList.toggle('on', !!a); return 1; }
    if (kind === 'hide') { fxGlow.classList.remove('on'); fxBox.classList.remove('on'); clearTimeout(fxTimer); fxTimer = setTimeout(() => { if (fxCur) fxCur.style.opacity = '0'; fxLast = null; }, 2600); return 1; }
    return 0;
  }

  window.__cx = { v: 5, fx, snapshot, readText, locate, domClick, prep, setValue, selectOpt, checkState, scrollTo, waitFor, settle, mark, vis, metrics, rectPage };
})();
