#!/usr/bin/env python3
"""Verify the served native frontend against the local build manifest."""

import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://localhost:8093"
AUDIT = ROOT / ".audit/konclui-runtime"
MANIFEST = json.loads((AUDIT / "frontend-manifest.json").read_text())


def request(path, headers=None):
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        if error.code != 304:
            raise
        response = error
    with response:
        return response.status, response.headers, response.read()


results = {"commit": MANIFEST["commit"], "protocolHash": MANIFEST["protocolHash"], "requests": []}
status, headers, body = request("/")
assert status == 200
assert MANIFEST["protocolHash"].encode() in body, "HTML protocol differs from the built frontend"
assert b"moment-hud.js" not in body and b"konclui-theme" not in body, "Legacy injection is active"
results["requests"].append({"path": "/", "status": status})
script = re.search(rb'<script[^>]*src="((?:\./|/)assets/[^\"]+\.js)"', body)
assert script, "No built frontend module in the page"
asset = urllib.parse.urlparse(urllib.parse.urljoin(BASE + "/", script.group(1).decode())).path
status, headers, body = request(asset)
assert status == 200
assert hashlib.sha256(body).hexdigest() == MANIFEST["files"][asset.lstrip("/")], "Served bundle differs from the target build"
assert "immutable" in headers.get("Cache-Control", ""), "Hashed bundle lacks immutable caching"
assert not any(key.lower().startswith("x-konclui-") for key in headers), "Unexpected legacy gateway patch header"
results["requests"].append({"path": asset, "status": status, "cacheControl": headers.get("Cache-Control"), "sha256": hashlib.sha256(body).hexdigest()})
sprite = next(path for path in MANIFEST["files"] if path.startswith("resources/customisation/") and path.endswith(".png"))
path = "/" + urllib.parse.quote(sprite)
status, headers, body = request(path)
assert status == 200 and body.startswith(b"\x89PNG\r\n\x1a\n")
assert "max-age=86400" in headers.get("Cache-Control", ""), "Sprite lacks the upstream one-day cache policy"
etag = headers.get("ETag")
assert etag, "Sprite has no cache validator"
cached_status, _, cached_body = request(path, {"If-None-Match": etag})
assert cached_status == 304 and not cached_body
results["requests"].append({"path": path, "status": status, "cacheControl": headers.get("Cache-Control"), "conditionalStatus": cached_status})
status, _, body = request("/map-storage/baseline/office.wam")
assert status == 200 and json.loads(body)["mapUrl"] == "tests/E2E/empty.json"
status, _, body = request("/map-storage/baseline/tests/E2E/empty.json")
assert status == 200 and json.loads(body)["width"] == 10
results["map"] = "upstream empty E2E map served through isolated map storage"
results["scope"] = "HTTP and build provenance only; player texture reuse and movement require a browser"
(AUDIT / "http-verification.json").write_text(json.dumps(results, indent=2) + "\n")
print("HTTP checks passed. Built bundle matches, sprite revalidates, isolated map is readable.")
