"""Observe sprite reuse and movement on an isolated local production build."""

import argparse
import asyncio
import hashlib
import json
import subprocess
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.async_api import Error as BrowserError, async_playwright


async def script_frame(page):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        for frame in page.frames:
            try:
                ready = await frame.evaluate("typeof WA !== 'undefined' && typeof WA.players?.list === 'function'")
                if ready:
                    await asyncio.wait_for(frame.evaluate("async () => { await WA.onInit(); await WA.players.configureTracking({players:true,movement:true}); }"), timeout=30)
                    return frame
            except BrowserError as error:
                if frame.is_detached() or "Execution context was destroyed" in str(error):
                    continue
                raise
        await asyncio.sleep(0.25)
    raise RuntimeError("The baseline map scripting API did not initialize within 90 seconds")


async def member(frame, name, present=True):
    await frame.wait_for_function(
        "({name,present}) => [...WA.players.list()].some(p => p.name === name) === present",
        arg={"name": name, "present": present},
        timeout=60000,
    )
    return await frame.evaluate(
        "name => [...WA.players.list()].filter(p => p.name === name).map(p => ({id:p.playerId,position:p.position}))",
        name,
    )


async def run(args):
    origin = urlparse(args.url)
    if origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("This probe only accepts an isolated HTTP localhost deployment")
    root = Path(__file__).resolve().parents[1]
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "url": args.url,
        "probeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "visitorTextures": args.visitor_textures,
        "visitorCompanion": args.visitor_companion,
        "texturePrefix": args.texture_prefix,
        "sourceHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "claim": "Functional sprite request reuse and remote movement, not a performance comparison",
        "runCount": 1,
        "devicePermissions": "Camera and microphone denied through CDP before navigation; synthetic device fallback only",
        "fixture": "Named visitors with saved texture and completed device-selection preferences",
        "renderer": "Chromium headless; no physical GPU performance claim",
        "errors": [],
        "phases": {},
    }
    manifest = root / args.manifest
    if manifest.exists():
        built = json.loads(manifest.read_text())
        report["builtSource"] = {key: value for key, value in built.items() if key != "files"}
    requests = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--use-fake-device-for-media-stream"])
        contexts = []
        try:
            async def open_player(name, textures, companion=None):
                context = await browser.new_context(permissions=[], viewport={"width": 1000, "height": 840})
                contexts.append(context)
                page = await context.new_page()
                permissions = await context.new_cdp_session(page)
                target = await permissions.send("Target.getTargetInfo")
                context_id = target["targetInfo"]["browserContextId"]
                for permission in ("camera", "microphone"):
                    await permissions.send("Browser.setPermission", {
                        "permission": {"name": permission}, "setting": "denied",
                        "origin": f"{origin.scheme}://{origin.netloc}", "browserContextId": context_id,
                    })
                await permissions.detach()
                await page.add_init_script(
                    "localStorage.setItem('playerName', " + json.dumps(name) + ");"
                    "localStorage.setItem('characterTextures', JSON.stringify(" + json.dumps(textures) + "));"
                    "localStorage.setItem('companion', " + json.dumps(json.dumps(companion)) + ");"
                    "localStorage.setItem('requestedCameraStateKey','false');"
                    "localStorage.setItem('requestedMicrophoneStateKey','false');"
                    "localStorage.setItem('cameraPrivacySettings','true');"
                    "localStorage.setItem('microphonePrivacySettings','true');"
                    "localStorage.setItem('preferredVideoInputDevice','');"
                    "localStorage.setItem('preferredAudioInputDevice','');"
                    "localStorage.setItem('workadventure_pwa_install_prompt_shown','true');"
                )
                page.on("pageerror", lambda error: report["errors"].append(str(error)))
                return context, page

            observer_context, observer = await open_player("CacheA", ["male1"])
            cdp = await observer_context.new_cdp_session(observer)
            await cdp.send("Network.enable")
            await cdp.send("Network.setCacheDisabled", {"cacheDisabled": False})
            cached_requests = set()
            revalidated_requests = set()
            cdp.on("Network.responseReceivedExtraInfo", lambda event: revalidated_requests.add(event["requestId"]) if event["statusCode"] == 304 else None)
            cdp.on("Network.requestServedFromCache", lambda event: cached_requests.add(event["requestId"]))

            def response(event):
                value = event["response"]
                path = unquote(urlparse(value["url"]).path)
                if "/resources/" in path and path.endswith(".png"):
                    headers = {key.lower(): val for key, val in value["headers"].items()}
                    requests.append({
                        "path": path, "status": value["status"], "requestId": event["requestId"],
                        "diskCache": value.get("fromDiskCache", False),
                        "memoryCache": event["requestId"] in cached_requests,
                        "serviceWorker": value.get("fromServiceWorker", False),
                        "cacheControl": headers.get("cache-control"),
                    })

            cdp.on("Network.responseReceived", response)
            await observer.goto(args.url, wait_until="domcontentloaded", timeout=90000)
            frame = await script_frame(observer)
            offset = len(requests)
            textures = args.visitor_textures
            expected_count = len(textures) + int(args.visitor_companion is not None)
            visitor_context, visitor = await open_player("CacheB", textures, args.visitor_companion)
            sent_frames = []
            visitor.on("websocket", lambda socket: socket.on("framesent", lambda data: sent_frames.append({
                "time": time.monotonic(), "bytes": len(data), "binary": isinstance(data, bytes),
            })))
            await visitor.goto(args.url, wait_until="domcontentloaded", timeout=90000)
            await script_frame(visitor)
            before = await member(frame, "CacheB")
            await observer.screenshot(path=str(output / "two-players.png"))
            initial = list(requests[offset:])
            custom = [item for item in initial if item["path"].startswith(args.texture_prefix)]
            assert len({item["path"] for item in custom}) == expected_count, f"Expected {expected_count} new visitor textures, got {custom}"
            assert len(custom) == expected_count, "Each missing layer must be fetched only once"
            assert all(item["status"] == 200 for item in custom), "Initial sprite requests must succeed"
            report["phases"]["firstAppearance"] = {"member": before, "requests": custom}

            movement_offset = len(sent_frames)
            await visitor.keyboard.down("ArrowRight")
            await asyncio.sleep(0.6)
            await visitor.keyboard.up("ArrowRight")
            await frame.wait_for_function(
                "({name,x,y}) => { const p=[...WA.players.list()].find(p=>p.name===name); return p && (p.position.x!==x || p.position.y!==y); }",
                arg={"name": "CacheB", **before[0]["position"]}, timeout=15000,
            )
            movement_frames = sent_frames[movement_offset:]
            assert any(item["binary"] for item in movement_frames), "Movement produced no observed binary frames"
            report["phases"]["movement"] = {
                "before": before, "after": await member(frame, "CacheB"),
                "sentFrames": movement_frames,
                "scope": "Payload bodies are not logged. These counts do not certify decoded movement fields or tick timing.",
            }
            await visitor_context.close()
            contexts.remove(visitor_context)
            await member(frame, "CacheB", False)
            offset = len(requests)
            visitor_context, visitor = await open_player("CacheB", textures, args.visitor_companion)
            await visitor.goto(args.url, wait_until="domcontentloaded", timeout=90000)
            await script_frame(visitor)
            returned = await member(frame, "CacheB")
            assert returned[0]["id"] != before[0]["id"], "Reappearance must be a new player session"
            repeated = [item for item in requests[offset:] if item["path"].startswith(args.texture_prefix)]
            assert not repeated, f"Reappearance requested loaded texture layers: {repeated}"
            report["phases"]["reappearance"] = {"member": returned, "requests": repeated}

            offset = len(requests)
            await observer.reload(wait_until="domcontentloaded", timeout=90000)
            frame = await script_frame(observer)
            await member(frame, "CacheB")
            reloads = [item for item in requests[offset:] if item["path"].startswith(args.texture_prefix)]
            assert len(reloads) == expected_count, f"Expected {expected_count} cached texture responses on reload, got {reloads}"
            for item in reloads:
                item["revalidated"] = item["requestId"] in revalidated_requests
            assert all(item["diskCache"] or item["memoryCache"] or item["serviceWorker"] or item["revalidated"] for item in reloads), "Reload did not reuse or revalidate every sprite texture"
            assert all(item["cacheControl"] and "max-age=" in item["cacheControl"] for item in custom), "Missing sprite cache headers"
            report["phases"]["reload"] = {"requests": reloads}
            assert not report["errors"], f"Browser errors: {report['errors']}"
            report["result"] = "PASS"
        except Exception as error:
            report["result"] = "FAIL"
            report["failure"] = str(error)
            for index, context in enumerate(contexts):
                for page_index, page in enumerate(context.pages):
                    try:
                        await page.screenshot(path=str(output / f"failure-{index}-{page_index}.png"), timeout=10000)
                        report.setdefault("diagnostics", []).append({
                            "path": urlparse(page.url).path,
                            "body": (await page.locator("body").inner_text(timeout=5000))[:3000],
                            "frames": [urlparse(frame.url).path for frame in page.frames],
                        })
                    except BrowserError as diagnostic_error:
                        report.setdefault("diagnosticErrors", []).append(type(diagnostic_error).__name__)
            raise
        finally:
            for context in contexts:
                await context.close()
            await browser.close()
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"result": report["result"], "report": str(output / "report.json")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8093/~/baseline/office.wam")
    parser.add_argument("--out", default=".audit/konclui-baseline-browser")
    parser.add_argument("--manifest", default=".audit/konclui-runtime/frontend-manifest.json")
    parser.add_argument("--visitor-textures", nargs="+", default=["body1", "eyes1", "hair1", "clothes1", "hat1", "accessory1"])
    parser.add_argument("--visitor-companion")
    parser.add_argument("--texture-prefix", default="/resources/customisation/")
    asyncio.run(run(parser.parse_args()))
