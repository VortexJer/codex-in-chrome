"""Real Chrome MCP check using one owned tab and a local disposable page."""
import asyncio
import base64
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import sys
import threading
import urllib.parse
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]

class Page(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
        result = f'<p id="result">Results for: {html.escape(q)}</p>' if parsed.path == "/search" else ""
        doc = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Codex local test</title>
<style>body{{font:20px system-ui;background:#f0f5f8;color:#183e50;padding:50px}}main{{max-width:650px;background:white;padding:36px;border-radius:18px}}input,button{{font:inherit;padding:10px;margin:8px 0}}button{{background:#174f60;color:white;border:0;border-radius:6px}}</style>
<main><h1>Codex local test</h1><p>This page checks navigation, reading and interaction.</p>{result}
<form action="/search"><label for="query">Search books</label><br><input id="query" name="q" type="text"><br><button type="submit">Search</button></form>
<p><a href="/next">Continue</a></p></main></html>'''
        raw = doc.encode()
        self.send_response(200); self.send_header("Content-Type", "text/html;charset=utf-8"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

def text(result): return "\n".join(c.text for c in result.content if getattr(c, "type", None) == "text")

async def main(server_path=None, screenshot_name="live-browser.jpg", idle_probe=None):
    http = ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    tab = None
    try:
        async with stdio_client(StdioServerParameters(command=shutil.which("node"), args=[str(server_path or ROOT / "server/mcp.js")])) as (reader, writer):
            async with ClientSession(reader, writer) as client:
                await client.initialize()
                async def call(name, args):
                    result = await client.call_tool(name, args)
                    if result.is_error: raise RuntimeError(text(result))
                    return result
                try:
                    created = text(await call("tabs", {"action":"new", "url":f"http://127.0.0.1:{http.server_port}/"}))
                    tab = int(re.search(r"tab (\d+)", created).group(1))
                    print(created[:2200], flush=True)
                    snap = text(await call("snap", {"tab":tab,"all":True}))
                    print(snap[:2200], flush=True)
                    input_ref = re.search(r"(e\d+)[^\n]*(?:Search books|textbox)",snap)
                    if not input_ref:
                        input_ref = re.search(r"(e\d+)[^\n]*(?:input|query)",snap)
                    assert input_ref, "search field appears in snapshot"
                    ref = input_ref.group(1)
                    typed = text(await call("do", {"tab":tab,"steps":[f"type {ref} Valencia"],"snap":"none"}))
                    assert "FAIL" not in typed, typed
                    submitted = text(await call("do", {"tab":tab,"steps":["key Enter"],"snap":"full"}))
                    assert "FAIL" not in submitted, submitted
                    page = text(await call("read", {"tab":tab}))
                    assert "Results for: Valencia" in page, page
                    if idle_probe is not None:
                        await idle_probe(client, tab)
                    await call("go", {"tab":tab,"url":f"http://127.0.0.1:{http.server_port}/next"})
                    page = text(await call("read", {"tab":tab}))
                    assert "Codex local test" in page
                    shot = await call("shot", {"tab":tab,"w":700})
                    artifacts = ROOT / "artifacts"; artifacts.mkdir(exist_ok=True)
                    for item in shot.content:
                        if getattr(item,"type",None) == "image":
                            (artifacts / screenshot_name).write_bytes(base64.b64decode(item.data))
                    print("LEAN LIVE BROWSER VERIFIED", flush=True)
                finally:
                    if tab is not None: await call("tabs", {"action":"close","tab":tab})
    finally: http.shutdown(); http.server_close()

if __name__ == "__main__":
    asyncio.run(main())
