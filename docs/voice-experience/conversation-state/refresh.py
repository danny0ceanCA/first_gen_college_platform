"""Mirror official Conversation-state documentation and selected integration contracts.

Python 3, standard library only. Run with --verify for an offline integrity check.
This script downloads documentation; it never calls a model or changes runtime config.
"""
import argparse
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ORIGIN = "https://developers.openai.com"
INDEXES = ["/api/reference/llms.txt", "/llms.txt"]
SEEDS = [
    "/api/docs/guides/conversation-state",
    "/api/docs/guides/compaction",
    "/api/docs/guides/websocket-mode",
    "/api/docs/guides/your-data",
    "/api/docs/guides/prompt-caching",
    "/api/docs/guides/live-conversations",
    "/api/docs/guides/live-delegation",
    "/api/reference/resources/conversations",
    "/api/reference/python/resources/conversations",
    "/api/reference/typescript/resources/conversations",
    "/api/reference/resources/responses/methods/compact",
    "/api/reference/resources/responses/methods/create",
    "/api/reference/resources/responses/methods/retrieve",
    "/api/reference/resources/responses/methods/delete",
    "/api/reference/resources/responses/subresources/input_items/methods/list",
    "/api/reference/resources/conversations/methods/create",
    "/api/reference/resources/conversations/methods/retrieve",
    "/api/reference/resources/conversations/methods/update",
    "/api/reference/resources/conversations/methods/delete",
    "/api/reference/resources/conversations/subresources/items/methods/create",
    "/api/reference/resources/conversations/subresources/items/methods/retrieve",
    "/api/reference/resources/conversations/subresources/items/methods/list",
    "/api/reference/resources/conversations/subresources/items/methods/delete",
]


def canonical(url):
    p = urlsplit(url)
    if p.scheme != "https" or p.netloc != "developers.openai.com":
        raise ValueError("Only official OpenAI documentation URLs are allowed")
    path = p.path.rstrip("/")
    if path.endswith(".md"):
        path = path[:-3]
    return urlunsplit((p.scheme, p.netloc, path, "", ""))


def read_url(url):
    with urlopen(Request(url, headers={"User-Agent": "Origen-Conversation-state-reference/1.0"}), timeout=60) as response:
        canonical(response.url)
        body = response.read()
        if not body.strip():
            raise ValueError("Empty response")
        if "html" in response.headers.get("Content-Type", "") or body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
            raise ValueError("Received HTML instead of documentation text")
        body.decode("utf-8")
        return body, response.url


def is_state(url):
    path = urlsplit(url).path
    return bool(re.search(r"/(?:conversations|conversation-state|compaction)(?:/|$)", path))


def write_atomic(destination, body):
    """Keep the previous complete file if downloading or writing fails."""
    temporary = None
    try:
        with NamedTemporaryFile(dir=destination.parent, prefix=".snapshot-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(body)
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def download(url):
    try:
        body, resolved = read_url(url + ".md")
        relative = Path("pages") / (urlsplit(url).path.strip("/") + ".md")
        destination = ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(destination, body)
        entry = {"source": url, "download_url": resolved, "file": relative.as_posix(),
                 "category": "conversation-state" if is_state(url) else "supporting-guidance",
                 "retrieved_at": datetime.now(timezone.utc).isoformat(),
                 "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
        links = []
        if is_state(url):
            for target in re.findall(r"\[[^\]]*\]\(([^\s)]+)", body.decode("utf-8")):
                try:
                    target = canonical(urljoin(url, target.strip("<>")))
                    if is_state(target) or urlsplit(target).path.startswith(("/api/docs/", "/api/reference/")):
                        links.append(target)
                except ValueError:
                    pass
        print("Saved", relative.as_posix(), flush=True)
        return entry, links, None
    except Exception as exc:
        print("Failed", url, str(exc), flush=True)
        return None, [], {"source": url, "error": str(exc)}


def verify():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    errors = []
    paths = set()
    for entry in manifest["pages"]:
        canonical(entry["source"])
        canonical(entry["download_url"])
        path = (ROOT / entry["file"]).resolve()
        if not path.is_relative_to(ROOT / "pages"):
            errors.append("Unsafe path: " + entry["file"])
            continue
        if entry["file"] in paths:
            errors.append("Duplicate path: " + entry["file"])
        paths.add(entry["file"])
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            errors.append("Missing or changed: " + entry["file"])
    errors += ["Unresolved download: " + f["source"] for f in manifest.get("failures", [])]
    extras = {p.relative_to(ROOT).as_posix() for p in (ROOT / "pages").rglob("*.md")} - paths
    errors += ["Unlisted page: " + p for p in extras]
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Verified {len(paths)} official Markdown snapshots; no missing, changed or unlisted pages.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        verify()
        return
    manifest_path = ROOT / "manifest.json"
    old = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    entries = {e["source"]: e for e in old.get("pages", [])}
    queue = {ORIGIN + p for p in SEEDS} | set(entries)
    discoveries, failures = [], []
    for index in INDEXES:
        try:
            body, resolved = read_url(ORIGIN + index)
            urls = []
            for url in re.findall(r"https://developers\.openai\.com/[^\s)>]+", body.decode("utf-8")):
                url = canonical(url)
                if is_state(url):
                    urls.append(url)
            queue.update(urls)
            discoveries.append({"source": resolved, "retrieved_at": datetime.now(timezone.utc).isoformat(),
                                "sha256": hashlib.sha256(body).hexdigest(), "state_urls": sorted(set(urls))})
        except Exception as exc:
            failures.append({"source": ORIGIN + index, "error": str(exc)})
    seen = set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        while queue - seen:
            batch = sorted(queue - seen)
            seen.update(batch)
            for entry, links, failure in pool.map(download, batch):
                if entry:
                    entries[entry["source"]] = entry
                queue.update(links)
                if failure:
                    failures.append(failure)
    manifest = {"scope": "Conversation-state guides, Conversations endpoints and SDK references; directly linked official documentation and selected Responses and Live state contracts.",
                "refreshed_at": datetime.now(timezone.utc).isoformat(), "discovery": discoveries,
                "pages": sorted(entries.values(), key=lambda e: e["source"]), "failures": failures}
    write_atomic(manifest_path, (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    rows = ["# Official snapshot inventory", "", "Generated by `refresh.py`; see `manifest.json` for sources, retrieval times and checksums.", ""]
    for category in ("conversation-state", "supporting-guidance"):
        rows += ["## " + category.replace("-", " ").title(), ""]
        rows += [f"- [{e['file']}]({e['file']}) — [official source]({e['source']})" for e in manifest["pages"] if e["category"] == category]
        rows.append("")
    write_atomic(ROOT / "INVENTORY.md", "\n".join(rows).encode("utf-8"))
    if failures:
        raise SystemExit(1)
    verify()


if __name__ == "__main__":
    main()
