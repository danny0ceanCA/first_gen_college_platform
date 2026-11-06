import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponsesExtractor, createSyntheticExtractor } from './extractor.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';

const source = () => demoSources()[0];
const providerPayload = extraction => ({ ...extraction, items: extraction.items.map(({ kind, status, ...item }) =>
  ({ ...item, classification: `${kind}:${status}` })) });
const completed = extraction => ({ status: 'completed', output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(providerPayload(extraction)) }] },
] });
const reply = body => ({ ok: true, json: async () => body });
const fakeExtractor = fetcher => createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', fetcher });
const errorCode = code => error => error.code === code;

test('interpretation — malformed output diagnostics identify the stage without copying text or hidden reasoning', async () => {
  let diagnostic;
  const extract = createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', reasoningEffort: 'low',
    onDiagnostic: value => { diagnostic = value; }, fetcher: async () => reply({
      status: 'completed', usage: { input_tokens: 100, output_tokens: 80, output_tokens_details: { reasoning_tokens: 25 } },
      output: [{ type: 'reasoning', content: 'private-reasoning' },
        { type: 'message', content: [{ type: 'output_text', text: '{private-invalid-output' }] }],
    }) });
  await assert.rejects(extract(source()), errorCode('invalid_extraction'));
  assert.equal(diagnostic.parseStage, 'output_json');
  assert.equal(diagnostic.responseStatus, 'completed');
  assert.equal(diagnostic.reasoningTokens, 25);
  assert.equal(diagnostic.outputTextParts, 1);
  assert.equal(diagnostic.outputTextLength, 23);
  assert.ok(!JSON.stringify(diagnostic).includes('private-'));
});

test('phase 2 — Responses adapter requests strict offline extraction without tools or provider storage', async () => {
  let request;
  const extract = fakeExtractor(async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return reply(completed(demoExtraction(source())));
  });
  assert.deepEqual(await extract(source()), demoExtraction(source()));
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.schema.additionalProperties, false);
  assert.equal(request.body.tools, undefined);
  assert.equal(request.body.max_output_tokens, 6000);
  assert.equal(request.body.reasoning.effort, 'low');
  assert.equal(JSON.parse(request.body.input).source.kind, 'summary');
  assert.equal(JSON.parse(request.body.input).source.accountId, undefined);
  assert.equal(JSON.parse(request.body.input).source.recordedAt, undefined);
  assert.deepEqual(request.body.text.format.schema.properties.items.items.properties.occurredAt.enum, [null]);
  assert.match(request.body.instructions, /first-generation college students and their families/);
  assert.match(request.body.instructions, /unknown/);
});

test('phase 2 — adapter configuration never reads ambient provider secrets or chooses a model implicitly', () => {
  assert.throws(() => createResponsesExtractor(), errorCode('extractor_configuration_required'));
  assert.throws(() => createResponsesExtractor({ apiKey: 'test-only' }), errorCode('extractor_configuration_required'));
  assert.throws(() => createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', timeoutMs: 0 }), errorCode('invalid_extractor_timeout'));
});

test('phase 2 — incomplete, refused, malformed, and unsupported provider results fail closed', async () => {
  const cases = [
    [{ status: 'incomplete', output: [] }, 'provider_incomplete'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }, 'provider_refused'],
    [{ status: 'completed', output: [] }, 'invalid_extraction'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] }, 'invalid_extraction'],
  ];
  for (const [body, code] of cases) {
    await assert.rejects(fakeExtractor(async () => reply(body))(source()), errorCode(code));
  }
  const unsupported = demoExtraction(source());
  unsupported.items[0].quote = 'A hallucinated quotation';
  await assert.rejects(fakeExtractor(async () => reply(completed(unsupported)))(source()), errorCode('unsupported_item_evidence'));
});

test('phase 2 — provider errors omit provider body and secrets', async () => {
  await assert.rejects(fakeExtractor(async () => ({ ok: false, text: async () => 'private provider error body' }))(source()),
    error => error.code === 'provider_failed' && !error.message.includes('private'));
});

test('phase 2 — timeout aborts provider work and produces a retryable diagnostic category', async () => {
  const extract = createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', timeoutMs: 5,
    fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await assert.rejects(extract(source()), errorCode('provider_timeout'));
});

test('phase 2 — provider context excludes another family, sibling, and stale records', async () => {
  let input;
  const existingItems = [
    { id: 'current', accountId: source().accountId, studentId: source().studentId, state: 'current', episodeKey: 'getting-started', kind: 'question', reportedBy: 'student' },
    { id: 'sibling', accountId: source().accountId, studentId: 'leo', state: 'current' },
    { id: 'another-account', accountId: 'another-account', studentId: source().studentId, state: 'current' },
    { id: 'old', accountId: source().accountId, studentId: source().studentId, state: 'superseded' },
  ];
  const extract = fakeExtractor(async (_url, options) => {
    input = JSON.parse(JSON.parse(options.body).input);
    return reply(completed(demoExtraction(source())));
  });
  const episodes = [
    { accountId: source().accountId, studentId: source().studentId, episodeKey: 'allowed' },
    { accountId: source().accountId, studentId: 'leo', episodeKey: 'sibling-private' },
    { accountId: 'another-account', studentId: source().studentId, episodeKey: 'foreign-private' },
    { episodeKey: 'unscoped-private' },
  ];
  await extract(source(), { existingItems, episodes });
  assert.deepEqual(input.existingItems.map(item => item.id), ['current']);
  assert.equal(input.existingItems[0].accountId, undefined);
  assert.deepEqual(input.episodes.map(episode => episode.episodeKey), ['allowed']);
});

test('phase 2 — local synthetic extractor processes only reference fixtures and verifies links', async () => {
  const extractor = createSyntheticExtractor();
  const existingItems = [];
  for (const itemSource of demoSources()) {
    const extraction = await extractor(itemSource, { existingItems });
    for (const item of extraction.items) existingItems.push({ ...item,
      id: `${itemSource.id}@${itemSource.version}#${item.key}`,
      accountId: itemSource.accountId, studentId: itemSource.studentId, state: 'current' });
  }
  assert.ok(existingItems.length > 20);
  await assert.rejects(extractor({ ...source(), text: 'A new real conversation.' }), errorCode('unsupported_demo_source'));
});

test('interpretation — scoped prior evidence retains relationships, uncertainty and record grouping without save dates', async () => {
  let input;
  const base = { accountId: source().accountId, studentId: source().studentId, state: 'current',
    episodeKey: 'campus-visit', reportedBy: 'student', corrects: null };
  const older = { ...base, id: 'old@1#waiting', sourceId: 'old', sourceVersion: 1,
    kind: 'outcome', status: 'pending', statement: 'Still waiting for the visit.',
    quote: 'I have not received a visit date.', barrier: 'No visit date yet.', linksTo: null,
    recordedAt: '2026-09-01T00:00:00.000Z', privateDebug: 'never-send' };
  const newer = { ...base, id: 'new@1#call', sourceId: 'new', sourceVersion: 1,
    kind: 'action', status: 'completed', statement: 'Called to ask for a visit date.',
    quote: 'I called to ask for a date.', barrier: null, linksTo: older.id,
    recordedAt: '2026-09-02T00:00:00.000Z' };
  const context = { existingItems: [newer, older, { ...newer, id: 'private', studentId: 'sibling' }],
    episodes: [{ ...base, topic: 'college_basics', questionState: 'open', actionState: 'unknown',
      outcomeState: 'unknown', analysisEligible: false, privateDebug: 'never-send' }] };
  const before = structuredClone(context);
  const extract = fakeExtractor(async (_url, options) => {
    input = JSON.parse(JSON.parse(options.body).input);
    return reply(completed(demoExtraction(source())));
  });
  await extract(source(), context);
  assert.deepEqual(context, before);
  assert.deepEqual(input.existingItems.map(item => item.id), [older.id, newer.id]);
  assert.deepEqual(input.existingItems.map(item => item.sourceRecordOrder), [1, 2]);
  assert.equal(input.existingItems[0].quote, older.quote);
  assert.equal(input.existingItems[0].barrier, older.barrier);
  assert.equal(input.existingItems[1].linksTo, older.id);
  assert.equal(input.existingItems[1].corrects, null);
  assert.equal(input.episodes[0].outcomeState, 'unknown');
  assert.equal(input.episodes[0].analysisEligible, false);
  assert.ok(!JSON.stringify(input).includes('2026-09-'));
  assert.ok(!JSON.stringify(input).includes('never-send'));
  assert.ok(!JSON.stringify(input).includes('sibling'));
});

test('calibration — optional diagnostics report usage and valid candidate without leaking request headers', async () => {
  let before, diagnostic;
  const extract=createResponsesExtractor({apiKey:'sk-do-not-record',model:'gpt-6-luna',maxOutputTokens:3000,
    reasoningEffort:'none',serviceTier:'default',captureCandidate:true,beforeRequest:value=>{before=value;},onDiagnostic:value=>{diagnostic=value;},
    fetcher:async()=>reply({...completed(demoExtraction(source())),id:'resp_test',model:'gpt-6-luna',usage:{input_tokens:100,output_tokens:50}})});
  await extract(source());
  assert.equal(before.service_tier,'default');assert.equal(before.reasoning.effort,'none');
  assert.equal(before.max_output_tokens,3000);
  assert.deepEqual(diagnostic.usage,{inputTokens:100,outputTokens:50});
  assert.equal(diagnostic.responseId,'resp_test');assert.equal(diagnostic.outcome,'completed');
  assert.equal(diagnostic.sent,true);assert.ok(diagnostic.durationMs>=0);
  assert.deepEqual(diagnostic.candidate,demoExtraction(source()));
  assert.deepEqual(diagnostic.providerCandidate,providerPayload(demoExtraction(source())));
  assert.ok(!JSON.stringify({before,diagnostic}).includes('sk-do-not-record'));
});

test('calibration — budget denial and pre-cancellation do not send requests', async () => {
  let calls=0, diagnostic;
  const base={apiKey:'test-only',model:'gpt-6-luna',fetcher:async()=>{calls++;return reply({});},onDiagnostic:value=>{diagnostic=value;}};
  await assert.rejects(createResponsesExtractor({...base,beforeRequest:()=>{throw Object.assign(new Error('budget denied'),{code:'calibration_budget_exhausted'});}})(source()),errorCode('calibration_budget_exhausted'));
  assert.equal(calls,0);assert.equal(diagnostic.sent,false);
  const controller=new AbortController();controller.abort();
  await assert.rejects(createResponsesExtractor({...base,signal:controller.signal})(source()),errorCode('provider_cancelled'));
  assert.equal(calls,0);assert.equal(diagnostic.sent,false);
});

test('calibration — invalid structured candidate remains reviewable but never passes validation', async () => {
  let diagnostic;
  const candidate=demoExtraction(source());candidate.items[0].quote='Not present in the source';
  const extract=createResponsesExtractor({apiKey:'test-only',model:'gpt-6-luna',captureCandidate:true,onDiagnostic:value=>{diagnostic=value;},
    fetcher:async()=>reply({...completed(candidate),usage:{input_tokens:55,output_tokens:77}})});
  await assert.rejects(extract(source()),errorCode('unsupported_item_evidence'));
  assert.deepEqual(diagnostic.candidate,candidate);assert.equal(diagnostic.outcome,'failed');
  assert.deepEqual(diagnostic.usage,{inputTokens:55,outputTokens:77});
});

test('calibration — missing or corrupt usage stays unknown and provider exceptions are sanitized', async () => {
  let diagnostic;
  const base={apiKey:'test-only',model:'gpt-6-luna',onDiagnostic:value=>{diagnostic=value;}};
  await createResponsesExtractor({...base,fetcher:async()=>reply({...completed(demoExtraction(source())),usage:{input_tokens:-1,output_tokens:0}})})(source());
  assert.equal(diagnostic.usage,null);assert.equal('candidate' in diagnostic,false);
  await assert.rejects(createResponsesExtractor({...base,fetcher:async()=>{throw new Error('private api key secret');}})(source()),errorCode('provider_failed'));
  assert.ok(!JSON.stringify(diagnostic).includes('private'));assert.equal(diagnostic.sent,true);
});

test('metadata — rejected invented event dates remain inspectable without becoming stored observations', async () => {
  let diagnostic;
  const candidate = demoExtraction(source());
  candidate.items[0].occurredAt = source().recordedAt;
  const extract = createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', captureCandidate: true,
    onDiagnostic: value => { diagnostic = value; }, fetcher: async () => reply(completed(candidate)) });
  await assert.rejects(extract(source()), errorCode('unsupported_item_date'));
  assert.equal(diagnostic.outcome, 'failed');
  assert.equal(diagnostic.candidate.items[0].occurredAt, source().recordedAt);
});

test('metadata — Responses request keeps mixed-language source metadata constrained', async () => {
  const mixedSource = { ...source(), language: 'mixed' };
  let input, schema;
  const candidate = demoExtraction(source());
  candidate.items.forEach(item => { item.language = 'mixed'; });
  const extract = fakeExtractor(async (_url, options) => {
    const body = JSON.parse(options.body);
    input = JSON.parse(body.input); schema = body.text.format.schema;
    return reply(completed(candidate));
  });
  assert.equal((await extract(mixedSource)).items[0].language, 'mixed');
  assert.equal(input.source.language, 'mixed');
  assert.deepEqual(schema.properties.items.items.properties.language.enum, ['mixed']);
});

test('classification — invalid provider wire classification stays reviewable and fails closed', async () => {
  let diagnostic;
  const candidate = providerPayload(demoExtraction(source()));
  candidate.items[0].classification = 'action:exploring';
  const extract = createResponsesExtractor({ apiKey: 'test-only', model: 'test-model', captureCandidate: true,
    onDiagnostic: value => { diagnostic = value; }, fetcher: async () => reply({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate) }] },
    ] }) });
  await assert.rejects(extract(source()), errorCode('invalid_item_classification'));
  assert.equal(diagnostic.candidate, null);
  assert.deepEqual(diagnostic.providerCandidate, candidate);
});
