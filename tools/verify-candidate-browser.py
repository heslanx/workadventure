"""Verify native shell entry and controls on the isolated production candidate."""

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import Error as BrowserError, async_playwright

ROOT = Path(__file__).resolve().parents[1]
ROOM = "/~/konclui-office/office.wam"


def safe_url(value):
    parsed = urlparse(value)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}" if parsed.netloc else parsed.path


def safe_error(value):
    return re.sub(r"https?://[^\s\"'<>]+", lambda match: safe_url(match[0]), str(value))


async def settle(page):
    await page.evaluate("""async () => {
        const finite = document.getAnimations().filter(animation => {
            const timing = animation.effect?.getComputedTiming();
            return timing && timing.iterations !== Infinity && timing.endTime <= 1000;
        });
        await Promise.allSettled(finite.map(animation => animation.finished));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }""")


async def geometry(page):
    return await page.evaluate("""() => {
        const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
        const rect = element => {
            if (!visible(element)) return null;
            const {x,y,width,height,right,bottom} = element.getBoundingClientRect();
            return {x,y,width,height,right,bottom};
        };
        const shell = document.querySelector('[data-testid="konclui-shell"]');
        const viewport = shell?.querySelector(':scope > .viewport');
        const dock = document.querySelector('[data-testid="konclui-dock"]');
        const counts = {};
        for (const element of document.querySelectorAll('[data-testid]')) {
            if (!visible(element)) continue;
            const id = element.dataset.testid;
            counts[id] = (counts[id] || 0) + 1;
        }
        return {
            window: {width: innerWidth,height: innerHeight},
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            shell: rect(shell), viewport: rect(viewport),
            canvas: rect(document.querySelector('#game > canvas')),
            dock: rect(dock),
            gameCount: document.querySelectorAll('#game').length,
            canvasCount: document.querySelectorAll('#game > canvas').length,
            shellCount: document.querySelectorAll('[data-testid="konclui-shell"]').length,
            dockCount: document.querySelectorAll('[data-testid="konclui-dock"]').length,
            controls: [...(dock?.querySelectorAll('.dock-controls button, .dock-profile[role="button"]') || [])]
                .filter(visible).map(element => ({id:element.dataset.testid || element.getAttribute('aria-label'),rect:rect(element)})),
            popups: [...document.querySelectorAll('[data-testid="profile-menu"], [data-testid="media-settings-panel"]')].filter(visible).map(rect),
            visibleTestIds: counts,
            scripts: [...document.scripts].map(script => new URL(script.src || location.href).pathname),
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
    }""")


def assert_geometry(value):
    assert value["shellCount"] == value["dockCount"] == value["gameCount"] == value["canvasCount"] == 1, "Expected one shell, dock, game and canvas owner"
    width, height = value["window"]["width"], value["window"]["height"]
    assert max(value["documentWidth"], value["bodyWidth"]) <= width + 1, "Horizontal document overflow"
    for name in ("shell", "viewport", "canvas", "dock"):
        rect = value[name]
        assert rect and rect["width"] > 0 and rect["height"] > 0, f"{name} is not painted"
        assert rect["x"] >= -1 and rect["y"] >= -1 and rect["right"] <= width + 1 and rect["bottom"] <= height + 1, f"{name} exceeds viewport: {rect}"
    canvas, viewport = value["canvas"], value["viewport"]
    assert canvas["x"] >= viewport["x"] - 1 and canvas["right"] <= viewport["right"] + 1, "Canvas does not fit native shell viewport"
    assert canvas["y"] >= viewport["y"] - 1 and canvas["bottom"] <= viewport["bottom"] + 1, "Canvas height does not fit native shell viewport"
    for rect in value["popups"]:
        assert rect["x"] >= -1 and rect["y"] >= -1 and rect["right"] <= width + 1 and rect["bottom"] <= height + 1, f"Open popup exceeds viewport: {rect}"
    dock = value["dock"]
    for control in value["controls"]:
        rect = control["rect"]
        assert rect["x"] >= dock["x"] - 1 and rect["right"] <= dock["right"] + 1, f"Dock control is clipped: {control['id']}"
    for name, count in value["visibleTestIds"].items():
        if name in {"closeChatButton", "unreadMessagesCount"}:
            continue
        if name.endswith("-btn") or name in {"action-user", "media-settings-toggle-button", "media-settings-panel", "profile-menu"}:
            assert count == 1, f"Duplicate mounted visible control: {name}: {count}"
    assert not any("moment-hud" in name or "hud-profile" in name for name in value["scripts"]), "Legacy injected HUD entry point loaded"


async def run(args):
    origin = urlparse(args.base)
    if origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1"} or origin.port != 8094 or origin.path not in {"", "/"}:
        raise ValueError("Only the isolated candidate on HTTP loopback port8094 is allowed")
    base = args.base.rstrip("/")
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    if (output / "report.json").exists():
        raise ValueError("Use a new output directory to preserve earlier evidence")
    manifest_path = ROOT / ".audit/konclui-runtime" / args.label / "frontend-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    report = {
        "scope": "First native shell/map/dock slice. Not full product, media, performance or scale certification.",
        "startedAt": datetime.now(timezone.utc).isoformat(), "pid": os.getpid(),
        "url": base, "sourceHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "builtSource": {key: value for key, value in manifest.items() if key != "files"},
        "permissions": "Camera/microphone denied through CDP before navigation; fake device fallback enabled",
        "result": "INCOMPLETE", "cases": [], "pageErrors": [], "httpErrors": [], "requestFailures": [], "blockedExternal": [],
        "remainingGates": [
            "Room-wide roster and search remain unavailable in this slice",
            "Minimap/dock clearance cannot pass before native minimap migration",
            "Real group calls, reconnect, editor persistence, avatars and all remaining matrix features require separate runs",
            "Headless renderer does not prove physical GPU or modest-device performance",
            "Local-only routing disables browser cache; candidate cache behavior needs its separate Network probe",
        ],
    }
    (output / "resource.json").write_text(json.dumps({"owner": "candidate_browser_verification", "pid": os.getpid(), "startedAt": report["startedAt"], "purpose": report["scope"], "shutdown": "Playwright context/browser close in finally; runner has a 900-second deadline"}, indent=2) + "\n")
    contexts = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--use-fake-device-for-media-stream"])
        try:
            async def open_page(width=1000, touch=False):
                context = await browser.new_context(viewport={"width": width, "height": 840}, permissions=[], has_touch=touch)
                contexts.append(context)
                async def local_only(route):
                    parsed = urlparse(route.request.url)
                    if parsed.scheme in {"http", "https"} and parsed.hostname not in {"localhost", "127.0.0.1"}:
                        report["blockedExternal"].append(safe_url(route.request.url))
                        await route.abort()
                    else:
                        await route.continue_()
                await context.route("**/*", local_only)
                page = await context.new_page()
                page.set_default_timeout(12000)
                cdp = await context.new_cdp_session(page)
                target = await cdp.send("Target.getTargetInfo")
                for permission in ("camera", "microphone"):
                    await cdp.send("Browser.setPermission", {"permission": {"name": permission}, "setting": "denied", "origin": base, "browserContextId": target["targetInfo"]["browserContextId"]})
                await cdp.detach()
                saved = {"playerName": "NativeQA", "characterTextures": json.dumps(["male1"]), "requestedCameraStateKey": "false", "requestedMicrophoneStateKey": "false", "preferredVideoInputDevice": "", "preferredAudioInputDevice": "", "cameraPrivacySettings": "true", "microphonePrivacySettings": "true", "workadventure_pwa_install_prompt_shown": "true"}
                await page.add_init_script("for (const [key,value] of Object.entries(" + json.dumps(saved) + ")) localStorage.setItem(key,value);")
                page.on("pageerror", lambda error: report["pageErrors"].append(safe_error(error)))
                page.on("response", lambda response: report["httpErrors"].append({"url": safe_url(response.url), "status": response.status}) if response.status >= 400 else None)
                page.on("requestfailed", lambda request: report["requestFailures"].append({"url": safe_url(request.url), "error": safe_error(request.failure)}))
                return context, page

            async def capture(page, name):
                await settle(page)
                value = await geometry(page)
                await page.screenshot(path=str(output / f"{name}.png"))
                assert_geometry(value)
                return value

            async def case(page, name, action):
                entry = {"name": name}
                report["cases"].append(entry)
                try:
                    details = await action()
                    entry.update({"status": "PASS", "details": details})
                except Exception as error:
                    entry.update({"status": "FAIL", "failure": safe_error(error)})
                    try:
                        entry["geometry"] = await geometry(page)
                        entry["body"] = (await page.locator("body").inner_text())[:3000]
                        await page.screenshot(path=str(output / f"{name}-failure.png"), timeout=10000)
                    except BrowserError as diagnostic_error:
                        entry["diagnosticError"] = type(diagnostic_error).__name__
                    if name not in {"root-entry", "direct-entry"}:
                        try:
                            await page.reload(wait_until="domcontentloaded", timeout=30000)
                            await page.get_by_test_id("konclui-shell").wait_for(state="visible", timeout=30000)
                            entry["recovery"] = "Reloaded to isolate subsequent cases; failed verdict retained"
                        except BrowserError as recovery_error:
                            entry["recovery"] = safe_error(recovery_error)
                print(json.dumps({"case": name, "status": entry["status"]}), flush=True)
                return entry["status"] == "PASS"

            async def enter(page, path, name):
                await page.goto(base + path, wait_until="domcontentloaded", timeout=90000)
                await page.get_by_test_id("konclui-shell").wait_for(state="visible", timeout=90000)
                await page.get_by_test_id("konclui-dock").wait_for(state="visible")
                assert urlparse(page.url).path == ROOM, "Entry did not resolve the canonical Konclui room"
                module = await page.locator('script[type="module"][src]').first.get_attribute("src")
                response = await page.request.get(base + "/" + module.removeprefix("./").lstrip("/"))
                module_path = urlparse(module).path.removeprefix("./").lstrip("/")
                actual_sha = hashlib.sha256(await response.body()).hexdigest()
                assert response.ok and actual_sha == manifest["files"][module_path], "Served entry module differs from frozen candidate"
                protocol = await page.locator('meta[name="wa-api-version"]').get_attribute("content")
                assert protocol == manifest["protocolHash"], "Served frontend protocol differs from generated candidate identity"
                value = await capture(page, name)
                value["entryModule"] = {"path": module_path, "sha256": actual_sha, "protocolHash": protocol}
                return value

            root_context, root_page = await open_page(1440)
            await case(root_page, "root-entry", lambda: enter(root_page, "/", "root-entry"))
            await root_context.close()
            contexts.remove(root_context)
            context, page = await open_page()
            entered = await case(page, "direct-entry", lambda: enter(page, ROOM, "direct-entry"))
            if entered:
                for width in (360, 768, 1000, 1440):
                    await page.set_viewport_size({"width": width, "height": 840})
                    await case(page, f"width-{width}", lambda width=width: capture(page, f"width-{width}"))
                    async def people_flow():
                        panel = page.get_by_role("complementary", name="Pessoas no escritório")
                        opener = page.get_by_role("button", name="Pessoas", exact=True).filter(visible=True)
                        if not await panel.is_visible():
                            await opener.press("Enter")
                        await panel.wait_for(state="visible")
                        opened = await capture(page, f"people-{width}")
                        close = page.get_by_role("button", name="Recolher o painel")
                        await close.focus()
                        await close.press("Escape")
                        await panel.wait_for(state="hidden")
                        assert await opener.evaluate("element => element === document.activeElement"), "People close did not restore focus to visible opener"
                        return {"open": opened, "closed": await capture(page, f"people-closed-{width}")}
                    await case(page, f"people-keyboard-{width}", people_flow)
                    async def chat_flow():
                        opener = page.get_by_test_id("chat-btn")
                        assert await opener.is_enabled(), "Chat opener unavailable in candidate"
                        await opener.press("Enter")
                        await page.get_by_test_id("chat").wait_for(state="visible")
                        opened = await capture(page, f"chat-{width}")
                        await page.get_by_role("button", name="Fechar conversa").press("Enter")
                        await page.get_by_test_id("chat").wait_for(state="hidden")
                        return {"open": opened, "closed": await capture(page, f"chat-closed-{width}")}
                    await case(page, f"chat-keyboard-{width}", chat_flow)
                    async def chat_to_people():
                        people = page.get_by_role("button", name="Pessoas", exact=True).filter(visible=True)
                        panel = page.get_by_role("complementary", name="Pessoas no escritório")
                        if not await panel.is_visible():
                            await people.press("Enter")
                        await panel.wait_for(state="visible")
                        await page.get_by_test_id("chat-btn").press("Enter")
                        await page.get_by_test_id("chat").wait_for(state="visible")
                        await people.press("Enter")
                        await page.get_by_role("searchbox", name="Pesquisar pessoas").wait_for(state="visible")
                        assert not await page.get_by_test_id("chat").is_visible(), "Chat remained visible after switching to People"
                        switched = await capture(page, f"chat-to-people-{width}")
                        await page.get_by_role("button", name="Recolher o painel").press("Enter")
                        return switched
                    await case(page, f"chat-to-people-{width}", chat_to_people)
                    async def profile_flow():
                        trigger = page.get_by_role("button", name="Abrir perfil")
                        await trigger.press("Enter")
                        await page.get_by_test_id("profile-menu").wait_for(state="visible")
                        opened = await capture(page, f"profile-{width}")
                        await trigger.press("Enter")
                        await page.get_by_test_id("profile-menu").wait_for(state="hidden")
                        return {"open": opened, "closed": await capture(page, f"profile-closed-{width}")}
                    await case(page, f"profile-keyboard-{width}", profile_flow)
                    async def media_flow():
                        trigger = page.get_by_test_id("media-settings-toggle-button")
                        await trigger.press("Enter")
                        await page.get_by_test_id("media-settings-panel").wait_for(state="visible")
                        opened = await capture(page, f"media-{width}")
                        await trigger.press("Enter")
                        await page.get_by_test_id("media-settings-panel").wait_for(state="hidden")
                        return {"open": opened, "closed": await capture(page, f"media-closed-{width}")}
                    await case(page, f"media-keyboard-{width}", media_flow)
                async def reload():
                    await page.reload(wait_until="domcontentloaded", timeout=90000)
                    await page.get_by_test_id("konclui-shell").wait_for(state="visible", timeout=90000)
                    return await capture(page, "reload")
                await case(page, "reload", reload)
                async def history():
                    await enter(page, "/?native-probe=history", "history-root")
                    await page.go_back(wait_until="domcontentloaded", timeout=90000)
                    await page.get_by_test_id("konclui-shell").wait_for(state="visible", timeout=90000)
                    backward = await capture(page, "history-back")
                    await page.go_forward(wait_until="domcontentloaded", timeout=90000)
                    await page.get_by_test_id("konclui-shell").wait_for(state="visible", timeout=90000)
                    return {"back": backward, "forward": await capture(page, "history-forward")}
                await case(page, "history-navigation", history)
                await page.emulate_media(reduced_motion="reduce")
                await page.set_viewport_size({"width": 360, "height": 840})
                await case(page, "reduced-motion", lambda: capture(page, "reduced-motion"))
                await context.close()
                contexts.remove(context)
                touch_context, touch_page = await open_page(360, touch=True)
                async def touch():
                    await enter(touch_page, ROOM, "touch-entry")
                    await touch_page.get_by_role("button", name="Pessoas", exact=True).filter(visible=True).tap()
                    await touch_page.get_by_role("button", name="Recolher o painel").wait_for(state="visible")
                    opened = await capture(touch_page, "touch-people")
                    await touch_page.get_by_role("button", name="Recolher o painel").tap()
                    return {"open": opened, "closed": await capture(touch_page, "touch-closed")}
                await case(touch_page, "touch-people", touch)
            report["result"] = "PASS" if report["cases"] and all(case["status"] == "PASS" for case in report["cases"]) and not report["pageErrors"] and not report["httpErrors"] and not any(urlparse(item["url"]).hostname in {"localhost", "127.0.0.1"} and item["error"] != "net::ERR_ABORTED" for item in report["requestFailures"]) else "FAIL"
        finally:
            try:
                for context in contexts:
                    try:
                        await context.close()
                    except BrowserError as error:
                        report.setdefault("cleanupErrors", []).append(safe_error(error))
            finally:
                await browser.close()
            if report.get("cleanupErrors"):
                report["result"] = "FAIL"
            report["finishedAt"] = datetime.now(timezone.utc).isoformat()
            report["resources"] = "All task-created contexts and browser closed through Playwright API"
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    if report["result"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:8094")
    parser.add_argument("--label", default="candidate-contract-20261112")
    parser.add_argument("--out", default=".audit/konclui-candidate-browser/first-slice")
    asyncio.run(asyncio.wait_for(run(parser.parse_args()), timeout=900))
