#!/usr/bin/env python3
"""Resolve image tags, digests and platforms from public registries.

Metadata only: tag lists, manifests/indexes and (for single-platform images)
the small config JSON. No image layer is requested. Anonymous tokens only.
Usage: python3 -I resolve_tags.py > lookups.json 2> lookups.log
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request

ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)

REGISTRIES = {
    "docker.io": ("https://registry-1.docker.io", "https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull"),
    "ghcr.io": ("https://ghcr.io", "https://ghcr.io/token?service=ghcr.io&scope=repository:{repo}:pull"),
}

SEMVER = r"(\d+)\.(\d+)\.(\d+)"

# key -> (registry, repo, current tag, regex with numeric groups, group index used as "line")
IMAGES = {
    "node": ("docker.io", "library/node", "24-trixie-slim", rf"^{SEMVER}-trixie-slim$", [0]),
    "traefik": ("docker.io", "library/traefik", "v3.6.1", rf"^v{SEMVER}$", [0]),
    "iconserver": ("docker.io", "matthiasluedtke/iconserver", "v3.21.0", rf"^v{SEMVER}$", [0]),
    "redis": ("docker.io", "library/redis", "6", rf"^{SEMVER}$", [0]),
    "tcm-php": ("docker.io", "thecodingmachine/php", "8.1-v4-apache-node12", r"^(\d+)\.(\d+)-v(\d+)-apache-node(\d+)$", [0, 1, 2]),
    "livekit-server": ("docker.io", "livekit/livekit-server", "v1.13.11", rf"^v{SEMVER}$", [0]),
    "livekit-egress": ("docker.io", "livekit/egress", "v1.15.0", rf"^v{SEMVER}$", [0]),
    "rustfs": ("docker.io", "rustfs/rustfs", "1.0.0-alpha.83", rf"^{SEMVER}(?:-(alpha|beta|rc)\.(\d+))?$", [0]),
    "aws-cli": ("docker.io", "amazon/aws-cli", "2.31.1", rf"^{SEMVER}$", [0]),
    "alpine": ("docker.io", "library/alpine", "3.14", rf"^{SEMVER}$", [0, 1]),
    "tcm-nodejs": ("ghcr.io", "thecodingmachine/nodejs", "v2-24-trixie", r"^v(\d+)-(\d+)-trixie$", [0, 1]),
    "tcm-nodejs-build": ("ghcr.io", "thecodingmachine/nodejs", "v2-24-trixie-build", r"^v(\d+)-(\d+)-trixie-build$", [0, 1]),
    "redisinsight": ("docker.io", "redislabs/redisinsight", "latest", rf"^{SEMVER}$", [0]),
    "redisinsight-new-repo": ("docker.io", "redis/redisinsight", "latest", rf"^{SEMVER}$", [0]),
    "oidc-server-mock": ("ghcr.io", "soluto/oidc-server-mock", "0.7.0", rf"^{SEMVER}$", [0]),
    "synapse": ("docker.io", "matrixdotorg/synapse", "v1.140.0", rf"^v{SEMVER}$", [0]),
    "nginx": ("docker.io", "library/nginx", "1.30-alpine3.24", rf"^{SEMVER}-alpine(\d+)\.(\d+)$", [0, 1]),
    "busybox": ("docker.io", "library/busybox", "latest", rf"^{SEMVER}$", [0]),
}

PRE_RANK = {"alpha": 0, "beta": 1, "rc": 2, None: 3}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def http(url, headers=None, method="GET"):
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()[:300]
    except Exception as err:  # network failure is recorded, never guessed around
        return None, {}, repr(err).encode()


def token(registry, repo):
    status, _, body = http(REGISTRIES[registry][1].format(repo=repo))
    if status != 200:
        return None, f"token HTTP {status}: {body[:120]!r}"
    return json.loads(body).get("token"), None


def list_tags(registry, repo, tok):
    base = REGISTRIES[registry][0]
    url = f"{base}/v2/{repo}/tags/list?n=1000"
    tags = []
    pages = 0
    while url and pages < 60:
        status, headers, body = http(url, {"Authorization": f"Bearer {tok}"})
        if status != 200:
            return tags, f"tags/list HTTP {status}: {body[:120]!r}"
        tags.extend(json.loads(body).get("tags") or [])
        pages += 1
        link = headers.get("Link") or headers.get("link")
        url = None
        if link:
            match = re.search(r"<([^>]+)>", link)
            if match:
                nxt = match.group(1)
                url = nxt if nxt.startswith("http") else base + nxt
    return tags, None


def version_key(match):
    parts = []
    for group in match.groups():
        if group is None or group in PRE_RANK:
            parts.append(PRE_RANK[group])
        else:
            parts.append(int(group))
    # rustfs pattern: (maj, min, patch, pre, n) -> a final release has pre=None, n=None
    return tuple(parts)


def rustfs_key(match):
    major, minor, patch, pre, num = match.groups()
    return (int(major), int(minor), int(patch), PRE_RANK[pre], int(num) if num else 0)


def inspect(registry, repo, ref, tok):
    base = REGISTRIES[registry][0]
    status, headers, body = http(
        f"{base}/v2/{repo}/manifests/{ref}", {"Authorization": f"Bearer {tok}", "Accept": ACCEPT}
    )
    info = {"ref": ref, "http": status}
    remaining = headers.get("ratelimit-remaining") or headers.get("RateLimit-Remaining")
    if remaining:
        info["ratelimit_remaining"] = remaining
    if status != 200:
        info["error"] = f"manifest HTTP {status}: {body[:160]!r}"
        return info
    info["digest"] = headers.get("Docker-Content-Digest") or headers.get("docker-content-digest")
    doc = json.loads(body)
    info["media_type"] = doc.get("mediaType") or headers.get("Content-Type")
    if "manifests" in doc:
        plats = []
        for entry in doc["manifests"]:
            plat = entry.get("platform") or {}
            if plat.get("os") in (None, "unknown"):
                continue  # attestation manifests
            name = f"{plat.get('os')}/{plat.get('architecture')}"
            if plat.get("variant"):
                name += f"/{plat['variant']}"
            plats.append(name)
        info["platforms"] = sorted(set(plats))
    else:
        cfg = (doc.get("config") or {}).get("digest")
        if cfg:
            cstatus, _, cbody = http(f"{base}/v2/{repo}/blobs/{cfg}", {"Authorization": f"Bearer {tok}"})
            if cstatus == 200:
                conf = json.loads(cbody)
                info["platforms"] = [f"{conf.get('os')}/{conf.get('architecture')}"]
                info["created"] = conf.get("created")
            else:
                info["platforms_error"] = f"config blob HTTP {cstatus}"
    return info


def hub_pushed(repo, tag):
    """Docker Hub web API (not the registry): last push time of a tag."""
    status, _, body = http(f"https://hub.docker.com/v2/repositories/{repo}/tags/{tag}")
    if status != 200:
        return f"hub API HTTP {status}"
    return json.loads(body).get("tag_last_pushed")


def extra():
    """Second pass: per-major latest tags, push dates, and the newest node 24 tag that ships arm64."""
    out = {"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "images": {}}
    hub_refs = json.loads(sys.stdin.read() or "{}")
    for key, (registry, repo, current, pattern, _line) in IMAGES.items():
        rec = {}
        out["images"][key] = rec
        tok, err = token(registry, repo)
        if err:
            rec["error"] = err
            continue
        tags, err = list_tags(registry, repo, tok)
        if err:
            rec["tags_error"] = err
        keyfn = rustfs_key if key == "rustfs" else version_key
        versions = sorted((keyfn(m), t) for t in tags for m in [re.match(pattern, t)] if m)
        per_major = {}
        for vkey, tag in versions:
            per_major[str(vkey[0])] = tag
        rec["latest_per_major"] = per_major
        if key == "node":
            line = [v[1] for v in versions if v[0][0] == 24][-5:]
            rec["node24_newest_first"] = []
            for tag in reversed(line):
                item = inspect(registry, repo, tag, tok)
                rec["node24_newest_first"].append(item)
                plats = item.get("platforms", [])
                log(f"node: {tag} digest={item.get('digest')} platforms={','.join(plats)} {item.get('error', '')}")
                if "linux/amd64" in plats and any(p.startswith("linux/arm64") for p in plats):
                    rec["newest_24_with_amd64_and_arm64"] = tag
                    break
        if key == "redis" and "7" in per_major:
            rec["redis7"] = inspect(registry, repo, per_major["7"], tok)
            log(f"redis: {per_major['7']} digest={rec['redis7'].get('digest')} platforms={','.join(rec['redis7'].get('platforms', []))}")
        if registry == "docker.io":
            rec["tag_last_pushed"] = {tag: hub_pushed(repo, tag) for tag in hub_refs.get(key, [])}
        log(f"{key}: per_major={per_major} pushed={rec.get('tag_last_pushed')}")
    json.dump(out, sys.stdout, indent=1)


def main():
    if sys.argv[1:2] == ["--extra"]:
        return extra()
    only = set(sys.argv[1:])
    out = {"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "images": {}}
    for key, (registry, repo, current, pattern, line_groups) in IMAGES.items():
        if only and key not in only:
            continue
        rec = {"registry": registry, "repo": repo, "current_tag": current}
        out["images"][key] = rec
        tok, err = token(registry, repo)
        if err:
            rec["error"] = err
            log(f"{key}: FAIL {err}")
            continue
        tags, err = list_tags(registry, repo, tok)
        rec["tag_count"] = len(tags)
        if err:
            rec["tags_error"] = err
            log(f"{key}: FAIL {err}")
        keyfn = rustfs_key if key == "rustfs" else version_key
        versions = []
        for tag in tags:
            match = re.match(pattern, tag)
            if match:
                versions.append((keyfn(match), tag))
        versions.sort()
        rec["matching_tags"] = len(versions)
        cur_match = re.match(pattern, current)
        if cur_match:
            cur_key = keyfn(cur_match)
            line = tuple(cur_key[i] for i in line_groups)
        else:
            # floating tag such as "24-trixie-slim", "6", "3.14", "1.30-alpine3.24", "latest"
            nums = [int(n) for n in re.findall(r"\d+", current.split("-")[0])]
            line = tuple(nums[: len(line_groups)]) if current != "latest" else None
        rec["line"] = line
        same_line = [v for v in versions if line is not None and tuple(v[0][i] for i in line_groups) == line]
        rec["latest_same_line"] = same_line[-1][1] if same_line else None
        rec["latest_overall"] = versions[-1][1] if versions else None
        rec["top5_overall"] = [v[1] for v in versions[-5:]]
        if key == "rustfs":
            finals = [v for v in versions if v[0][3] == PRE_RANK[None]]
            rec["latest_final_release"] = finals[-1][1] if finals else None
        if key in ("tcm-php",):
            rec["php_lines"] = sorted({f"{v[0][0]}.{v[0][1]}-v{v[0][2]}" for v in versions})
            rec["node_variants_same_line"] = [v[1] for v in same_line]
        if key in ("tcm-nodejs", "tcm-nodejs-build"):
            rec["all_matching"] = [v[1] for v in versions]
        refs = []
        for ref in (current, rec["latest_same_line"], rec["latest_overall"], rec.get("latest_final_release")):
            if ref and ref not in refs:
                refs.append(ref)
        rec["inspected"] = [inspect(registry, repo, ref, tok) for ref in refs]
        for item in rec["inspected"]:
            log(
                f"{key}: {repo}:{item['ref']} http={item['http']} digest={item.get('digest')} "
                f"platforms={','.join(item.get('platforms', []))} {item.get('error', '')}"
            )
        log(
            f"{key}: tags={rec['tag_count']} matching={rec['matching_tags']} "
            f"same_line={rec['latest_same_line']} overall={rec['latest_overall']}"
        )
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
