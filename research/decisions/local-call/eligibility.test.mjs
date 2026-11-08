import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallProjector } from './projector.mjs';
import { conversationOwnsSupport } from './support-routing.mjs';

const seed = { fictional: true, accountId: 'fictional-account', callId: 'fictional-call', studentId: 'fictional-student', language: 'en' };
const task = (changes = {}) => ({ type: 'research_task', scopeGeneration: 0, jobId: 'fictional-job', revision: 1,
  question: 'What is the published annual total?', status: 'queued', evidenceVersion: null, evidenceAvailability: 'missing', findings: [], ...changes });
const finding = (language, changes = {}) => ({ fact: language === 'en' ? 'Annual estimated total is 40,000.' : 'El total anual estimado es 40,000.',
  year: '2026–27', scenario: 'off campus', limitation: language === 'en' ? 'Before aid; excludes summer.' : 'Antes de ayuda; no incluye el verano.',
  status: 'partial', subject: 'Fictional university', aspect: 'total_budget', sourceIds: ['1'], ...changes });

function setup(language = 'en') {
  const captures = [], logs = [];
  const projector = createCallProjector({ ...seed, language }, (state, eligibility) => captures.push({ snapshot: state.snapshot(), eligibility }), row => logs.push(row));
  let sequence = 0;
  const boundary = (role, text) => projector.receive({ source: 'application', atMs: ++sequence,
    event: role === 'user' ? { type: 'conversation.item.input_audio_transcription.completed', item_id: `u${sequence}`, transcript: text }
      : { type: 'response.output_audio_transcript.done', response_id: `a${sequence}`, transcript: text } });
  const native = (role, text) => projector.receive({ source: 'native', atMs: ++sequence, event: {
    type: role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
    event_id: `n${sequence}`, start_ms: sequence * 10, end_ms: sequence * 10 + 1, delta: text } });
  const research = value => projector.receive({ source: 'research', atMs: ++sequence, event: task(value) });
  return { projector, captures, logs, boundary, native, research, eligible: () => captures.filter(row => row.eligibility.eligible) };
}

for (const language of ['en', 'es']) {
  test(`${language}: assistant snapshots remain available without consuming inference, but accepting an offer remains eligible`, () => {
    const h = setup(language);
    h.boundary('user', language === 'en' ? 'I do not know where to start.' : 'No sé por dónde empezar.');
    const offer = language === 'en' ? 'Would a simple example help?' : '¿Te ayudaría un ejemplo sencillo?';
    h.boundary('assistant', offer);
    const acknowledgment = language === 'en' ? 'Okay.' : 'Sí.';
    h.boundary('user', acknowledgment); h.boundary('user', acknowledgment);
    assert.equal(h.captures.length, 4); assert.equal(h.eligible().length, 3);
    assert.equal(h.captures[1].eligibility.reason, 'assistant_context_only');
    assert.equal(h.captures[2].eligibility.callerChanged, true);
    assert.equal(h.captures[2].snapshot.recentTranscripts.at(-2).text, offer);
    assert.equal(h.captures[3].eligibility.callerChanged, true, 'a rapid fresh caller span must replace a stale acceptance candidate');
    h.boundary('assistant', language === 'en' ? 'Shall we try one together?' : '¿Probamos uno juntos?');
    h.boundary('user', acknowledgment); assert.equal(h.eligible().length, 4);
    const confusion = language === 'en' ? 'I still do not understand.' : 'Todavía no entiendo.';
    h.boundary('user', confusion); h.boundary('user', confusion);
    assert.equal(h.eligible().length, 6, 'repeated confusion must not be mistaken for an empty acknowledgment');
    assert.ok(h.captures.every(row => row.snapshot.playbackEvidence.length === 0));
  });

  test(`${language}: classify new research facts and terminal states, not queued/running transitions or version-only polling`, () => {
    const h = setup(language);
    h.boundary('user', language === 'en' ? 'What is the annual total?' : '¿Cuál es el total anual?');
    h.research({}); h.research({ revision: 2, status: 'running' });
    assert.equal(h.eligible().length, 1); assert.equal(h.captures.length, 3);
    const findings = [finding(language)];
    h.research({ revision: 3, status: 'running', evidenceVersion: 1, evidenceAvailability: 'available', findings });
    assert.equal(h.eligible().length, 2);
    h.research({ revision: 4, status: 'running', evidenceVersion: 2, evidenceAvailability: 'available', findings });
    assert.equal(h.eligible().length, 2);
    h.research({ revision: 5, status: 'completed', evidenceVersion: 3, evidenceAvailability: 'available', findings });
    assert.equal(h.eligible().length, 3, 'terminal partial results must remain eligible');
    h.research({ revision: 6, status: 'completed', evidenceVersion: 4, evidenceAvailability: 'available', findings });
    assert.equal(h.eligible().length, 3);
    const qualified = h.eligible().at(-1).snapshot.researchTasks[0].findings[0];
    assert.equal(qualified.year, '2026–27'); assert.equal(qualified.scenario, 'off campus'); assert.equal(qualified.limitation, findings[0].limitation);
    h.research({ revision: 7, status: 'completed', evidenceVersion: 5, evidenceAvailability: 'available', findings: [finding(language, { scenario: 'with family' })] });
    assert.equal(h.eligible().length, 4);
    h.research({ revision: 8, status: 'failed' }); h.research({ revision: 9, status: 'failed' });
    assert.equal(h.eligible().length, 5);
    h.research({ revision: 10, status: 'cancelled' }); assert.equal(h.eligible().length, 6);
    assert.ok(h.eligible().slice(1).every(row => row.eligibility.researchChanged));
  });

  test(`${language}: pending research coalesces after an estimated thought, while changed caller intent wins`, () => {
    const h = setup(language), answer = language === 'en' ? 'A yearly budget includes living expenses.' : 'El presupuesto anual incluye gastos de vida.';
    h.boundary('user', language === 'en' ? 'What is an annual budget?' : '¿Qué es un presupuesto anual?');
    h.native('assistant', answer);
    h.research({ revision: 1, status: 'running', evidenceVersion: 1, evidenceAvailability: 'available', findings: [finding(language)] });
    h.research({ revision: 2, status: 'completed', evidenceVersion: 2, evidenceAvailability: 'available', findings: [finding(language)] });
    assert.equal(h.eligible().length, 1); assert.equal(h.projector.state.snapshot().researchTasks[0].status, 'completed');
    h.boundary('assistant', answer); assert.equal(h.eligible().length, 2);
    assert.equal(h.eligible()[1].eligibility.reason, 'research_evidence_changed');
    h.boundary('assistant', language === 'en' ? 'That is an estimate.' : 'Es una estimación.');
    assert.equal(h.eligible().length, 2);
    h.native('user', language === 'en' ? 'Actually, ' : 'En realidad, ');
    h.research({ revision: 3, status: 'completed', evidenceVersion: 3, evidenceAvailability: 'available', findings: [finding(language, { scenario: 'with family' })] });
    assert.equal(h.eligible().length, 2);
    const question = language === 'en' ? 'Actually, explain tuition only.' : 'En realidad, explícame solo la matrícula.';
    h.boundary('user', question); assert.equal(h.eligible().length, 3);
    assert.equal(h.eligible().at(-1).snapshot.currentQuestion.text, question);
    assert.equal(h.eligible().at(-1).eligibility.reason, 'caller_and_research_changed');
    assert.deepEqual(h.eligible().at(-1).eligibility.researchJobIds, ['fictional-job']);
  });
}

test('a reconnect invalidates pending evidence, and native duplicates never create extra inferences', () => {
  const h = setup(); h.boundary('user', 'Where should we begin?');
  h.native('assistant', 'One simple step.'); h.research({ status: 'completed' });
  h.projector.receive({ source: 'connection', atMs: 20, event: { type: 'browser_control_detached' } });
  h.boundary('assistant', 'Old buffered words.');
  assert.equal(h.eligible().length, 1);
  h.native('user', 'I need an example.'); h.boundary('user', 'I need an example.');
  assert.equal(h.eligible().length, 2); assert.equal(h.eligible().at(-1).eligibility.researchChanged, false);
  assert.equal(h.projector.state.snapshot().authorized, true);
});

test('duplicate delivery of one caller span skips, while a distinct rapid acknowledgment stays eligible', () => {
  const h = setup(); h.boundary('assistant', 'Would a short example help?');
  const packet = { source: 'application', atMs: 10, event: { type: 'conversation.item.input_audio_transcription.completed', item_id: 'accept-1', transcript: 'Okay.' } };
  h.projector.receive(packet); h.projector.receive(packet);
  assert.equal(h.eligible().length, 1);
  h.projector.receive({ ...packet, event: { ...packet.event, item_id: 'accept-2' } });
  assert.equal(h.eligible().length, 2);
  assert.equal(h.eligible().at(-1).snapshot.currentQuestion.id, 'user:accept-2');
});

test('legacy support only yields to a confident actionable conversational classification', () => {
  for (const [field, action] of [['confusion', 'needs_simpler_explanation'], ['continuation', 'accepted_conversational_offer']]) {
    const result = changes => ({ conversationSupport: { [field]: { action, confidence: 0.85, selectedProbability: 0.9, ...changes } } });
    assert.equal(conversationOwnsSupport(result()), true);
    for (const changes of [{ confidence: 0.849 }, { selectedProbability: 0.899 }, { confidence: NaN }, { selectedProbability: 1.1 }, { action: 'none' }])
      assert.equal(conversationOwnsSupport(result(changes)), false);
  }
  assert.equal(conversationOwnsSupport(null), false);
});
