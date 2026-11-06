const toWire = value => ({...value,items:value.items.map(({kind,status,...item})=>({...item,classification:`${kind}:${status}`}))});
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNetworkExtraction } from './worker.mjs';
import { demoSources, demoExtraction } from '../../research/network-effects/fixtures.mjs';

function setup({ budget = true, usage = true, response = 'valid', sourceId = 'demo-college-start',
  verificationBudget = true, verificationResponse = 'valid' } = {}) {
  const source = demoSources().find(value => value.id === sourceId), calls = [];
  const job = { id: 'ce2c139c-7808-48b4-8bdd-00a455297372', token: 'cf23d3f7-3dc0-48a6-85f6-940fd4d53952', source };
  const repository = { claim: async opts => { calls.push(['claim', opts]); return job; }, contextFor: async () => ({}),
    reserveBudget: async args => { calls.push(['reserve',args]); return { accepted: budget && (!args.reservationId.endsWith('.verification') || verificationBudget), duplicate: false }; },
    settleBudget: async args => { calls.push(['settle',args]); }, recordJobDiagnostic: async (...args) => { calls.push(['diagnostic',...args]); },
    recordVerification: async (...args) => { calls.push(['verification',...args]); return args[1]; },
    complete: async (...args) => { calls.push(['complete',...args]); return 1; }, failure: async (...args) => { calls.push(['failure',...args]); return 'failed'; } };
  const fetcher = async (url, options) => {
    const request=JSON.parse(options.body);calls.push(['fetch',request]);
    const verification = request.text.format.name === 'college_navigation_verification_edits';
    if (response === 'network-failure' || verification && verificationResponse === 'network-failure') throw new Error('secret provider message');
    const issue = { type: 'uncertain', quote: source.text, detail: 'The outcome needs further evidence.', itemKey: null };
    const patch = { obstacles: [], decision: 'keep', issues: [], edits: [], additions: [] };
    const verificationValue = verificationResponse === 'needs_review' ? { ...patch, decision: 'needs_review', issues: [issue] }
      : verificationResponse === 'invalid' ? { ...patch, decision: 'approved' }
      : verificationResponse === 'invalid-issue' ? { ...patch, decision: 'needs_review', issues: [{ ...issue, quote: 'This was never in the source.' }] }
      : verificationResponse === 'invalid-replacement' ? { ...patch, decision: 'revise', issues: [{ ...issue, type: 'omission' }], additions: [{ item: { invented: true }, issueIndex: 0 }] }
      : patch;
    return { ok: !(verification && verificationResponse === 'http-failure'), json: async () => ({ id: 'resp_fictional', model: 'gpt-6-luna', status: 'completed',
      ...(usage ? { usage: { input_tokens: 100, output_tokens: 80 } } : {}),
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(response === 'invalid' ? { items: [{ invented: true }] }
        : verification ? verificationValue : toWire(demoExtraction(source))) }] }] }) };
  };
  return { calls, repository, options: { apiKey: 'fictional-key', budgetId: 'fixture-budget', capUsd: 1, fetcher } };
}
test('budget reservation precedes provider request; usage and evidence persist separately', async () => {
  const { calls, repository, options } = setup();
  const result = await runNetworkExtraction(repository, options);
  assert.equal(result.status, 'completed');
  assert.ok(calls.findIndex(([name]) => name==='reserve') < calls.findIndex(([name]) => name==='fetch'));
  const request = calls.find(([name]) => name==='fetch')[1];
  assert.equal(request.store, false); assert.equal(request.service_tier, 'default'); assert.equal(request.tools, undefined);
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(calls.find(([name]) => name==='settle')[1].actualUsd, 0.00005);
});
test('exhausted budget makes zero provider calls and stops the worker', async () => {
  const { calls, repository, options } = setup({ budget: false });
  const result = await runNetworkExtraction(repository, options);
  assert.equal(result.status, 'failed'); assert.equal(result.stop, true); assert.ok(!calls.some(([name]) => name==='fetch'));
});
test('uncertain usage retains reservation; invalid evidence is never committed', async () => {
  for (const config of [{ usage: false }, { response: 'network-failure' }, { response: 'invalid' }]) {
    const { calls, repository, options } = setup(config);
    await runNetworkExtraction(repository, options);
    if (config.usage === false || config.response === 'network-failure') assert.ok(!calls.some(([name]) => name==='settle'));
    if (config.response) assert.ok(!calls.some(([name]) => name==='complete'));
    assert.ok(!JSON.stringify(calls.filter(([name]) => name==='diagnostic')).includes('secret provider message'));
  }
});
test('cancelled worker does not claim work', async () => {
  const { calls, repository, options } = setup();
  await assert.rejects(runNetworkExtraction(repository, { ...options, signal: AbortSignal.abort() })); assert.equal(calls.length, 0);
});

const stageTwoConfig = { sourceId: 'demo-application-pending' }; // Explicit completed action always triggers verification.
const attempts = calls => calls.filter(([name]) => name === 'verification').map(([, , audit]) => audit);
const reservations = calls => calls.filter(([name]) => name === 'reserve').map(([, value]) => value);
function assertSeparateStages(calls) {
  const reserved = reservations(calls);
  assert.equal(reserved.length, 2);
  assert.notEqual(reserved[0].reservationId, reserved[1].reservationId);
  assert.ok(reserved[0].reservationId.endsWith('.extraction'));
  assert.ok(reserved[1].reservationId.endsWith('.verification'));
  assert.equal(reserved[0].budgetId, reserved[1].budgetId);
  const pendingIndex = calls.findIndex(([name, , value]) => name === 'verification' && value.decision === 'pending');
  const verifyReservationIndex = calls.findIndex(([name, value]) => name === 'reserve' && value.reservationId.endsWith('.verification'));
  assert.ok(pendingIndex >= 0 && pendingIndex < verifyReservationIndex, 'initial candidate must be persisted before reserving or sending verification');
  assert.ok(!calls.some(([name]) => name === 'complete'), 'no fallback publishing of the unchecked initial candidate');
  const audits = attempts(calls);
  assert.equal(audits.length, 2);
  assert.equal(audits[0].decision, 'pending');
  assert.deepEqual(audits[0].initial, audits[1].initial);
  assert.equal(audits[1].final, null);
  assert.deepEqual(audits[1].steps.map(step => step.stage), ['extraction', 'verification']);
  return { reserved, audits };
}

test('stage-two budget denial retains the initial candidate in a failed audit without a verifier call or fallback', async () => {
  const { calls, repository, options } = setup({ ...stageTwoConfig, verificationBudget: false });
  const result = await runNetworkExtraction(repository, options);
  assert.equal(result.status, 'failed');
  assert.equal(result.stop, true);
  const { reserved, audits } = assertSeparateStages(calls);
  assert.equal(calls.filter(([name]) => name === 'fetch').length, 1);
  assert.equal(audits[1].decision, 'failed');
  assert.equal(audits[1].steps[1].sent, false);
  assert.equal(audits[1].steps[1].errorCode, 'network_budget_exhausted');
  assert.equal(calls.find(([name]) => name === 'failure')[2].code, 'network_budget_exhausted');
  const settled = calls.filter(([name]) => name === 'settle').map(([, value]) => value);
  assert.deepEqual(settled.map(value => value.reservationId), [reserved[0].reservationId]);
});

test('verifier needs_review stays a terminal review hold and never publishes or overwrites the decision as failed', async () => {
  const { calls, repository, options } = setup({ ...stageTwoConfig, verificationResponse: 'needs_review' });
  const result = await runNetworkExtraction(repository, options);
  assert.equal(result.status, 'failed');
  assert.equal(result.stop, false);
  const { reserved, audits } = assertSeparateStages(calls);
  assert.equal(calls.filter(([name]) => name === 'fetch').length, 2);
  assert.equal(audits[1].decision, 'needs_review');
  assert.equal(audits[1].issues.length, 1);
  assert.equal(audits[1].steps[1].outcome, 'completed');
  assert.equal(calls.find(([name]) => name === 'failure')[2].code, 'verification_needs_review');
  assert.deepEqual(calls.filter(([name]) => name === 'settle').map(([, value]) => value.reservationId), reserved.map(value => value.reservationId));
});

test('invalid verifier evidence fails closed after both separately metered calls', async () => {
  for (const [verificationResponse, expectedCode] of [
    ['invalid', 'invalid_verification'], ['invalid-issue', 'invalid_verification_issue'], ['invalid-replacement', 'invalid_verification'],
  ]) {
    const { calls, repository, options } = setup({ ...stageTwoConfig, verificationResponse });
    const result = await runNetworkExtraction(repository, options);
    assert.equal(result.status, 'failed', verificationResponse);
    assert.equal(result.stop, false);
    const { reserved, audits } = assertSeparateStages(calls);
    assert.equal(audits[1].decision, 'failed');
    assert.equal(audits[1].steps[1].outcome, 'failed');
    assert.equal(audits[1].steps[1].sent, true);
    assert.equal(audits[1].steps[1].errorCode, expectedCode);
    assert.equal(calls.find(([name]) => name === 'failure')[2].code, expectedCode);
    assert.equal(calls.filter(([name]) => name === 'fetch').length, 2);
    assert.deepEqual(calls.filter(([name]) => name === 'settle').map(([, value]) => value.reservationId), reserved.map(value => value.reservationId));
  }
});

test('verifier transport or HTTP failure retains its full reservation and never falls back to the initial candidate', async () => {
  for (const verificationResponse of ['network-failure', 'http-failure']) {
    const { calls, repository, options } = setup({ ...stageTwoConfig, verificationResponse });
    const result = await runNetworkExtraction(repository, options);
    assert.equal(result.status, 'failed');
    const { reserved, audits } = assertSeparateStages(calls);
    assert.equal(audits[1].decision, 'failed');
    assert.equal(audits[1].steps[1].usage, null);
    assert.equal(audits[1].steps[1].sent, true);
    assert.equal(audits[1].steps[1].errorCode, 'provider_failed');
    assert.equal(calls.filter(([name]) => name === 'fetch').length, 2);
    assert.deepEqual(calls.filter(([name]) => name === 'settle').map(([, value]) => value.reservationId), [reserved[0].reservationId]);
    assert.equal(calls.find(([name]) => name === 'failure')[2].code, 'provider_failed');
    assert.equal(JSON.stringify(audits).includes('secret provider message'), false);
  }
});
