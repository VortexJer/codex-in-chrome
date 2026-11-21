"""Full current extension+MCP+hub in a disposable browser and isolated port."""
import asyncio
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from playwright.async_api import async_playwright
from test_live import main as run_browser
from test_support import fixture_dir

ROOT=Path(__file__).resolve().parents[2]

async def main():
    with fixture_dir('e2e-') as tmp:
        fixture=Path(tmp)
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1",0)); port=reserved.getsockname()[1]
        extension=fixture / "extension"; shutil.copytree(ROOT / "extension",extension)
        worker=extension / "background.js"
        worker.write_text(worker.read_text(encoding="utf-8").replace("const PORT = 17333;",f"const PORT = {port};",1),encoding="utf-8")
        server=fixture / "server"; server.mkdir()
        for name in ("hub.js","mcp.js"): shutil.copyfile(ROOT / "server" / name,server / name)
        cfg=json.loads((ROOT / "server/config.json").read_text(encoding="utf-8")); cfg["port"]=port
        (server / "config.json").write_text(json.dumps(cfg),encoding="utf-8")
        hub=subprocess.Popen([shutil.which("node"),str(server / "hub.js")],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/status",timeout=.5): break
                except OSError: await asyncio.sleep(.1)
            async with async_playwright() as p:
                executable=os.environ.get('CHROME_EXECUTABLE')
                context=await p.chromium.launch_persistent_context(str(fixture / "profile"),executable_path=executable,channel='chromium',headless=True,args=[f"--disable-extensions-except={extension}",f"--load-extension={extension}"],viewport={"width":1000,"height":750})
                try:
                    if not context.service_workers: await context.wait_for_event("serviceworker")
                    page=await context.new_page(); await page.goto(f"chrome-extension://{cfg['extId']}/permissions.html")
                    await page.locator('#status').wait_for()
                    async with stdio_client(StdioServerParameters(command=shutil.which('node'),args=[str(server / 'mcp.js')])) as (r,w):
                        async with ClientSession(r,w) as client:
                            await client.initialize()
                            denied=await client.call_tool('tabs',{'action':'list'})
                            assert denied.is_error, 'fresh extension denies browser access before UI authorization'
                            await page.locator('#scope').select_option('all'); await page.locator('#mode').select_option('control'); await page.locator('#allow').click()
                            await page.wait_for_function("document.querySelector('#perm').textContent.includes('read and interact')")
                            async def idle_probe(browser_client, tab):
                                before=await page.evaluate("chrome.runtime.sendMessage({t:'state'})")
                                assert before['debugging'] and any(t['id']==tab for t in before['tabs'])
                                print('Waiting for the real 45-second idle detach...',flush=True)
                                started=time.monotonic()
                                while True:
                                    idle=await page.evaluate("chrome.runtime.sendMessage({t:'state'})")
                                    if not idle['debugging']: break
                                    assert time.monotonic()-started<56, 'debugger did not detach after the idle period'
                                    await asyncio.sleep(1)
                                assert time.monotonic()-started>=43, 'debugger detached before the intended idle period'
                                assert idle['mode']=='wait' and any(t['id']==tab for t in idle['tabs'])
                                resumed=await browser_client.call_tool('snap',{'tab':tab})
                                assert not resumed.is_error
                                active=await page.evaluate("chrome.runtime.sendMessage({t:'state'})")
                                assert active['debugging'] and any(t['id']==tab for t in active['tabs'])
                                print('IDLE DETACH AND REATTACH VERIFIED',flush=True)
                            await run_browser(server / 'mcp.js','isolated-browser.jpg',idle_probe)
                            await page.locator('#mode').select_option('read'); await page.locator('#allow').click()
                            await page.wait_for_function("document.querySelector('#perm').textContent.includes('read only')")
                            denied=await client.call_tool('js',{'code':'document.title'})
                            assert denied.is_error, 'read-only mode rejects script execution over real MCP'
                            await page.locator('#stop').click()
                            await page.wait_for_function("document.querySelector('#perm').textContent === 'No permissions granted'")
                            denied=await client.call_tool('tabs',{'action':'list'})
                            assert denied.is_error, 'revocation takes effect over real MCP'
                    print('ISOLATED E2E VERIFIED')
                finally: await context.close()
        finally:
            hub.terminate(); hub.wait(timeout=5)

asyncio.run(main())
