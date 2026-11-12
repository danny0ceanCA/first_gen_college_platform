// Isolated Decisions transport. This module has no Live or application imports.
import { performance } from 'node:perf_hooks';

export const DECISIONS_ENDPOINT = 'https://api.openai.com/v1/decisions';
export const MAX_DECISIONS_REQUEST_BYTES = 32 * 1024;
export const serializeDecisionRequest = request => JSON.stringify({
  ...request, prompt_cache_options: { mode: 'explicit', ttl: '30m' },
});
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_KEYS = new Set(['model', 'input', 'questions', 'prompt_cache_options']);
const plainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class DecisionsClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DecisionsClientError';
    this.code = code;
    Object.assign(this, details);
  }
}

function invalid(message) {
  throw new DecisionsClientError('invalid_request', message);
}

function requestBody(request) {
  if (!plainObject(request) || Object.keys(request).some((key) => !REQUEST_KEYS.has(key))) {
    invalid('Only the isolated Decisions request fields are accepted.');
  }
  if (request.model !== 'gpt-6-luna') invalid('The Decisions model must be gpt-6-luna.');
  if (!(typeof request.input === 'string' || Array.isArray(request.input))) invalid('Input must be text or an array.');
  if (!Array.isArray(request.questions) || request.questions.length < 1 || request.questions.length > 400) {
    invalid('A Decisions request requires 1–400 questions.');
  }
  for (const question of request.questions) {
    if (!plainObject(question) || !['predicate', 'choice', 'score'].includes(question.type)
      || !(typeof question.instructions === 'string' || Array.isArray(question.instructions))) {
      invalid('Each question must have a supported type and instructions.');
    }
  }
  if (request.prompt_cache_options !== undefined) {
    const options = request.prompt_cache_options;
    if (!plainObject(options) || Object.keys(options).some((key) => !['mode', 'ttl'].includes(key))
      || options.mode !== 'explicit' || (options.ttl !== undefined && options.ttl !== '30m')) {
      invalid('This laboratory requires explicit cache mode without breakpoints.');
    }
  }
  const seen = new Set();
  function check(value, depth = 0) {
    if (!value || typeof value !== 'object') return;
    if (depth > 32 || seen.has(value)) invalid('Request nesting is unsupported.');
    seen.add(value);
    if (Object.hasOwn(value, 'prompt_cache_breakpoint')) invalid('Cache breakpoints are disabled in the laboratory.');
    for (const item of Object.values(value)) check(item, depth + 1);
    seen.delete(value);
  }
  check(request);
  let body;
  try {
    body = serializeDecisionRequest(request);
  } catch {
    invalid('Request must be serializable JSON.');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_DECISIONS_REQUEST_BYTES) invalid('Request exceeds the 32 KiB laboratory limit.');
  return body;
}

function responseRequestId(response) {
  const id = response.headers?.get?.('x-request-id');
  return typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(id) ? id : null;
}

async function boundedText(response, signal) {
  const length = response.headers?.get?.('content-length');
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    throw new DecisionsClientError('response_too_large', 'Provider response exceeds the laboratory limit.');
  }
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new DecisionsClientError('response_too_large', 'Provider response exceeds the laboratory limit.');
    }
    return value;
  }
  const reader = response.body.getReader();
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        cancel();
        throw new DecisionsClientError('response_too_large', 'Provider response exceeds the laboratory limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function createDecisionsClient({ apiKey, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) invalid('An explicit API key is required.');
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    invalid('Invalid transport or timeout.');
  }
  async function evaluate(request, { signal } = {}) {
    const body = requestBody(request);
    const started = performance.now();
    const controller = new AbortController();
    let requestId = null;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = (code) => {
      rejectAbort(new DecisionsClientError(code, code === 'timeout' ? 'Decisions request timed out.' : 'Decisions request was aborted.'));
      controller.abort();
    };
    const onAbort = () => abort('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => abort('timeout'), timeoutMs);
    try {
      if (signal?.aborted) {
        throw new DecisionsClientError('aborted', 'Decisions request was aborted.');
      }
      const work = (async () => {
        const response = await fetchImpl(DECISIONS_ENDPOINT, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
        });
        if (controller.signal.aborted) {
          Promise.resolve(response.body?.cancel?.()).catch(() => {});
          throw new DecisionsClientError('aborted', 'Decisions request was aborted.');
        }
        requestId = responseRequestId(response);
        if (!response.ok) {
          // Do not persist arbitrary provider text, which can echo submitted data.
          Promise.resolve(response.body?.cancel?.()).catch(() => {});
          throw new DecisionsClientError('http_error', 'Decisions provider rejected the request.', { status: response.status });
        }
        const text = await boundedText(response, controller.signal);
        let parsed;
        try { parsed = JSON.parse(text); } catch {
          throw new DecisionsClientError('invalid_json', 'Decisions provider returned invalid JSON.');
        }
        if (!plainObject(parsed)) throw new DecisionsClientError('invalid_response', 'Decisions response must be an object.');
        return parsed;
      })();
      // The race also bounds transports and body readers that ignore AbortSignal.
      const response = await Promise.race([work, aborted]);
      return { response, requestId, durationMs: performance.now() - started };
    } catch (error) {
      const failure = error instanceof DecisionsClientError ? error
        : new DecisionsClientError('transport_error', 'Decisions transport failed.');
      failure.requestId = requestId;
      failure.durationMs = performance.now() - started;
      throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return { evaluate };
}
