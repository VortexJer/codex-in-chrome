# Release validation

## Passed locally

- JavaScript syntax checks for every extension script.
- Permission policy: allowed origins, rejected subdomains and ports, expiry, session grants, read-only mode, and revocation.
- Controlled-tab ownership, rejection of foreign tabs, idle detach, and reattach in a Chrome API mock.
- Real hub sockets: origin checks, independent client request IDs, and disconnect cancellation.
- Real stdio MCP initialization and discovery of all eight tools.
- Install, reinstall, and uninstall against an isolated configuration, including CMD and PowerShell launchers, the original installer entry point, paths with spaces, backups, skill installation/removal, and preservation of unrelated servers.
- Rendered panel in real Chrome with **simulated Chrome APIs**: English defaults, permanent save, reload persistence, empty/invalid site rejection, valid restricted scope, read-only selection, and revoke persistence. This does not establish real extension debugger behavior.

- Real isolated Chromium panel: English controls, invalid origin rejection, restricted grants, permanent authorization across a browser restart, and persistent revocation.
- Real isolated Chromium through MCP: navigation, form typing and submission, text extraction, screenshots, 45-second idle detach and reattach, read-only rejection, and revocation.

The browser checks used an already installed Chromium executable selected with `CHROME_EXECUTABLE`. They ran in disposable profiles and isolated hub ports, not in the user's personal Chrome profile. A first attempt was blocked by session restrictions; the checks were rerun successfully after those restrictions were removed.

The installed extension was also updated after backing up its files and Codex configuration. A live check in the user's Chrome passed navigation, typing, submission, reading, and screenshots using a temporary local page and a tab created specifically for the check. The test closed that tab afterward. The saved browser grant remained usable after the extension reload.

## Integration

This update builds on the existing public main branch rather than replacing its history. Historical authors and coauthors retain their original credit. Every new release commit credits VortexJer and Codex.

The bundled workflow runs the core, installer, stdio, panel, and end-to-end checks on Windows. A local pass does not imply a hosted CI pass; inspect the repository's Actions page for the hosted result.
