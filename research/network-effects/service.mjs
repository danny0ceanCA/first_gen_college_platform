import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export async function startReviewServer(store, { port = 8791 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid_local_port');
  const reviewToken = randomBytes(32).toString('hex');
  let origin;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    const host = new URL(origin).host;
    if (request.headers.host !== host || request.headers['sec-fetch-site'] === 'cross-site'
        || request.headers.origin && request.headers.origin !== origin) return json(403, { error: 'local_origin_required' });
    const path = request.url?.split('?')[0];
    try {
      if (request.method === 'GET' && path === '/api/state') return json(200, { ...store.state(), reviewToken });
      if (request.method === 'GET' && assets.has(path)) {
        const [file, contentType] = assets.get(path);
        const body = await readFile(new URL(`./ui/${file}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': contentType });
        return response.end(body);
      }
      if (request.method === 'POST' && path === '/api/review') {
        if (request.headers['x-review-token'] !== reviewToken) return json(403, { error: 'review_token_required' });
        if (!request.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'json_required' });
        let body = '';
        for await (const part of request) {
          body += part;
          if (Buffer.byteLength(body) > 8192) return json(413, { error: 'request_too_large' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'invalid_json' }); }
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !['episodeId', 'expectedRevision', 'decision', 'note'].includes(key))) return json(400, { error: 'invalid_review' });
        return json(200, { ...store.review(input), reviewToken });
      }
      return json(404, { error: 'route_not_found' });
    } catch (error) {
      if (error.code === 'stale_review') return json(409, { error: 'stale_review' });
      if (error.code === 'invalid_review') return json(400, { error: 'invalid_review' });
      return json(500, { error: 'local_review_failed' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
