"""Download official Responses Markdown and directly related guides (Python 3)."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ORIGIN = 'https://developers.openai.com'
SEEDS = [
    '/api/reference/responses/overview',
    '/api/reference/python/resources/responses',
]


def canonical(url):
    p = urlsplit(url)
    path = p.path.rstrip('/')
    if path in ('/docs/guides/images', '/api/docs/guides/images'):
        path = '/api/docs/guides/images-vision'
    if path.startswith('/docs/'):
        path = '/api' + path
    if path.endswith('.md'):
        path = path[:-3]
    return urlunsplit((p.scheme, p.netloc, path, p.query, ''))


def fetch(url):
    p = urlsplit(url)
    markdown_url = urlunsplit((p.scheme, p.netloc, p.path + '.md', p.query, ''))
    with urlopen(Request(markdown_url, headers={'User-Agent': 'Origen-reference-library/1.0'}), timeout=45) as response:
        body = response.read()
        content_type = response.headers.get('Content-Type', '')
        if 'html' in content_type or body.lstrip().lower().startswith((b'<!doctype html', b'<html')):
            raise ValueError('Received HTML instead of Markdown')
        if not body.strip():
            raise ValueError('Empty response')
        return body, response.url


def main():
    queue = [ORIGIN + path for path in SEEDS]
    with urlopen(ORIGIN + '/api/reference/llms.txt', timeout=45) as response:
        index = response.read().decode('utf-8')
    queue += [u for u in re.findall(r'https://developers\.openai\.com/[^\s)>]+', index)
              if '/responses' in u or '/resources/conversations' in u]
    # Include the related guides already selected for Origen in the saved reference.
    reference = (ROOT.parent / 'OPENAI_RESPONSES_REFERENCE.md').read_text()
    queue += re.findall(r'https://developers\.openai\.com/[^\s)>]+', reference)
    queue = [u for u in queue if not u.endswith('llms.txt')]
    seen, entries, failures = set(), [], []
    while queue:
        url = canonical(queue.pop(0))
        if url in seen:
            continue
        seen.add(url)
        try:
            body, resolved = fetch(url)
            path = urlsplit(url).path.strip('/') + '.md'
            destination = ROOT / 'pages' / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(body)
            entries.append({'source': url, 'download_url': resolved, 'file': str(destination.relative_to(ROOT)),
                            'retrieved_at': datetime.now(timezone.utc).isoformat(), 'sha256': hashlib.sha256(body).hexdigest()})
            print('Saved', path, flush=True)
            # Follow links from the two supplied entry pages. Within their Responses
            # reference sections, follow nested endpoints/types as well; do not crawl
            # the entire documentation site through guide cross-links.
            if url in [ORIGIN + p for p in SEEDS] or '/reference/' in url:
                for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)', body.decode('utf-8')):
                    target = canonical(urljoin(url, target.strip('<>')))
                    p = urlsplit(target)
                    if p.netloc != 'developers.openai.com':
                        continue
                    if any(p.path.startswith(seed) for seed in ['/api/reference/responses/', '/api/reference/resources/responses', '/api/reference/python/resources/responses']):
                        queue.append(target)
                    elif ('/reference/' in url) and ('/guides/' in p.path or p.path.endswith('/quickstart')):
                        queue.append(target)
        except Exception as exc:
            failures.append({'source': url, 'error': str(exc)})
            print('Failed', url, str(exc), flush=True)
    # Keep earlier successful records if a refresh is partially unavailable.
    manifest_path = ROOT / 'manifest.json'
    old = json.loads(manifest_path.read_text()).get('pages', []) if manifest_path.exists() else []
    merged = {canonical(entry['source']): entry for entry in old}
    merged.update({entry['source']: entry for entry in entries})
    manifest_path.write_text(json.dumps({'pages': list(merged.values()), 'failures': failures}, indent=2) + '\n')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
