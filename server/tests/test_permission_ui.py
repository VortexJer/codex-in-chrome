"""Permission UI in an isolated Chromium profile. Never connects to the live hub."""
import json
from pathlib import Path
import shutil
import tempfile
import hashlib
import base64
import os
from playwright.sync_api import sync_playwright
from test_support import fixture_dir

ROOT = Path(__file__).resolve().parents[2]
executable = os.environ.get("CHROME_EXECUTABLE")
manifest = json.loads((ROOT / "extension/manifest.json").read_text(encoding="utf-8"))
key = base64.b64decode(manifest["key"])
ext_id = "".join(chr(97 + int(n,16)) for n in hashlib.sha256(key).hexdigest()[:32])
with fixture_dir('permissions-') as tmp:
    folder = Path(tmp)
    extension = folder / "extension"
    shutil.copytree(ROOT / "extension", extension)
    worker = extension / "background.js"
    code = worker.read_text(encoding="utf-8")
    assert "const PORT = 17333;" in code
    worker.write_text(code.replace("const PORT = 17333;", "const PORT = 17334;",1),encoding="utf-8")
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(folder / "profile"), executable_path=executable, headless=True,
            args=[f"--disable-extensions-except={extension}",f"--load-extension={extension}"], viewport={"width":800,"height":920})
        try:
            if not context.service_workers: context.wait_for_event("serviceworker")
            page = context.new_page()
            page.goto(f"chrome-extension://{ext_id}/permissions.html")
            page.locator("#status").wait_for()
            page.wait_for_function("document.querySelector('#perm').textContent === 'No permissions granted'")
            assert page.locator('#mode').input_value() == 'control'
            assert page.locator('#scope').input_value() == 'all'
            assert page.locator('#duration').input_value() == 'manual'
            assert not page.evaluate("chrome.storage.local.get('codexAccess')").get('codexAccess')
            page.locator('#scope').select_option('sites')
            page.locator("#allow").click()
            page.wait_for_function("document.querySelector('#message').textContent.includes('at least one site')")
            state = page.evaluate("chrome.storage.local.get('codexAccess')")
            assert not state.get("codexAccess",{}).get("enabled")
            page.locator("#sites").fill("https://example.org\nnot-a-url")
            page.locator("#allow").click()
            page.wait_for_function("document.querySelector('#message').classList.contains('error')")
            state = page.evaluate("chrome.storage.local.get('codexAccess')")
            assert not state.get("codexAccess",{}).get("enabled")
            page.locator("#sites").fill("https://example.org\nhttps://en.wikipedia.org")
            page.locator("#mode").select_option("control")
            page.locator("#duration").select_option("30")
            page.locator("#allow").click()
            page.wait_for_function("document.querySelector('#perm').textContent.includes('read and interact')")
            state = page.evaluate("chrome.storage.local.get('codexAccess')")["codexAccess"]
            assert state["enabled"] and state["mode"] == "control" and len(state["sites"]) == 2
            assert state["expiresAt"] > 0
            artifacts = ROOT / "artifacts"; artifacts.mkdir(exist_ok=True)
            page.screenshot(path=str(artifacts / "permission-panel.png"), full_page=True)
            page.locator("#mode").select_option("read")
            page.locator("#allow").click()
            page.wait_for_function("document.querySelector('#perm').textContent.includes('read only')")
            page.locator("#scope").select_option("all")
            assert page.locator("#sites-box").is_hidden()
            page.locator("#allow").click()
            state = page.evaluate("chrome.storage.local.get('codexAccess')")["codexAccess"]
            assert state["scope"] == "all" and state["sites"] == []
            page.locator("#stop").click()
            page.wait_for_function("document.querySelector('#perm').textContent === 'No permissions granted'")
            state = page.evaluate("chrome.storage.local.get('codexAccess')")["codexAccess"]
            assert state["enabled"] is False
            page.locator('#mode').select_option('control')
            page.locator('#duration').select_option('manual')
            page.locator('#allow').click()
            page.wait_for_function("document.querySelector('#perm').textContent === 'Saved: read and interact · all websites · permanent'")
            assert page.locator('html').get_attribute('lang') == 'en'
            page.screenshot(path=str(artifacts / 'permission-panel.png'), full_page=True)
            context.close()
            context = p.chromium.launch_persistent_context(str(folder / 'profile'), executable_path=executable, headless=True,
                args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'], viewport={'width':800,'height':920})
            page = context.new_page()
            page.goto(f'chrome-extension://{ext_id}/permissions.html')
            page.wait_for_function("document.querySelector('#perm').textContent === 'Saved: read and interact · all websites · permanent'")
            state = page.evaluate("chrome.storage.local.get('codexAccess')")['codexAccess']
            assert state['expiresAt'] is None and state['session'] is None
            page.locator('#stop').click()
            page.wait_for_function("document.querySelector('#perm').textContent === 'No permissions granted'")
            page.reload()
            page.wait_for_function("document.querySelector('#perm').textContent === 'No permissions granted'")
            print("PERMISSION UI VERIFIED")
        finally: context.close()
