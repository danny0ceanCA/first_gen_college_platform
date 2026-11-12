import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from './fixtures.mjs';
import { stateForFixture, main } from './cli.mjs';
import { buildDecisionRequest } from './rubric.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
test('lab dependencies stay inside lab or node builtins; no live writers', () => {
  for (const file of readdirSync(folder).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const source = readFileSync(resolve(folder, file), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('node:') || (match[1].startsWith('./') && !match[1].includes('..')), `${file}: ${match[1]}`);
    }
    assert.equal(/session\.(?:thinking|commentary|instructions)\.append|response\.create|new\s+WebSocket/.test(source), false, file);
  }
});
test('fixtures fit bounded state, keep original text, and omit labels from provider input', () => {
  assert.equal(fixtures.length, 36);
  for (const f of fixtures) {
    const s = stateForFixture(f).snapshot();
    assert.deepEqual(s.recentTranscripts.map(t => t.text), f.transcripts.map(t => t.text));
    const request = buildDecisionRequest(s);
    const input = JSON.parse(request.input);
    assert.equal(input.expected, undefined); assert.equal(input.split, undefined);
    assert.equal(request.input.includes(f.id), false, 'semantic fixture IDs must not leak labels');
    assert.equal(input.opportunities, undefined, 'do not leak addressed ledger labels into transcript classification');
    assert.equal(input.fingerprint, undefined); assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 32768);
  }
});
test('default CLI validates all fixtures without provider credentials or network', async () => {
  const summary = await main([]);
  assert.equal(summary.apiCalls, 0); assert.equal(summary.fixturesValidated, 36);
});
test('CLI rejects arbitrary inputs and approval increases before requests', async () => {
  await assert.rejects(main(['--input', 'real-students.json']), /unsupported_cli_option/);
  await assert.rejects(main(['--real', '--cap-usd', '6']), /cap_exceeds_approval/);
  await assert.rejects(main(['--fixture-ids', 'real-student']), /unknown_fixture/);
});
test('runtime uses only the explicit shared Decisions boundaries; experiments remain isolated', () => {
  const root = resolve(folder, '../..');
  // Decisions was intentionally integrated in production after the original
  // isolation test was written. Name the three reviewed boundaries explicitly,
  // and inspect new files too; do not exempt arbitrary server or script imports.
  const boundaries = new Map([
    ['server/voice-decisions.mjs', '../research/decisions/local-call/session.mjs'],
    ['server/decisions-diagnostic-data.mjs', '../research/decisions/diagnostic-classifications.mjs'],
    ['scripts/decisions-diagnostic-report.mjs', '../research/decisions/local-call/diagnostic-report.mjs'],
  ]);
  const files = ['src', 'server', 'scripts'].flatMap(dir => readdirSync(resolve(root, dir), { recursive: true })
    .map(name => `${dir}/${name.replaceAll('\\', '/')}`))
    .filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file) && !file.includes('/fixtures/'));
  for (const file of files) {
    const source=readFileSync(resolve(root,file),'utf8');
    assert.equal(/createObserverState|ORIGEN_DECISIONS_TEST_KEY/.test(source), false, file);
    const references = [...source.matchAll(/['"]([^'"\n]*research[\\/]decisions[^'"\n]*)['"]/g)].map(match => match[1]);
    assert.deepEqual(references, boundaries.has(file) ? [boundaries.get(file)] : [], file);
    assert.equal(/native-trigger-evaluation|validate-early-live|early-refinement-budget/.test(source), false, file);
  }
});
