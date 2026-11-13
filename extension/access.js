// Local permission policy. Only the extension UI can edit it; MCP tools cannot.
(() => {
  function origin(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Solo URLs http/https sin credenciales.');
    return url.origin;
  }
  function enabled(policy, session, now = Date.now()) {
    return !!(policy?.enabled === true && ['read', 'control'].includes(policy.mode) &&
      (!policy.expiresAt || Number.isFinite(policy.expiresAt) && policy.expiresAt > now) &&
      (!policy.session || policy.session === session));
  }
  function allowed(policy, url, session, now = Date.now()) {
    if (!enabled(policy, session, now)) return false;
    if (url === 'about:blank') return true; // temporary, controlled tab before navigation
    try {const site = origin(url); return policy.scope === 'all' || policy.scope === 'sites' && Array.isArray(policy.sites) && policy.sites.includes(site);} catch {return false;}
  }
  function checkTool(policy, session, method, params = {}) {
    if (!enabled(policy, session)) throw new Error('Acceso detenido o caducado. El usuario debe autorizarlo en el panel de Codex in Chrome.');
    if (policy.mode === 'read' && (['do', 'js'].includes(method) || method === 'tabs' && params.action === 'close')) throw new Error('Modo solo lectura: la interacción está desactivada en el panel.');
  }
  globalThis.CodexAccess = {origin, enabled, allowed, checkTool};
})();
