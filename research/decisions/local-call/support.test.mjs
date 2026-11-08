import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportGate, SUPPORT_NOTES } from './support.mjs';

function fixture(language = 'en', enabled = true) {
  let at = 0, sequence = 0;
  const commands = [], logs = [];
  const scope = { sessionId: 'fictional-call', studentId: 'fictional-student', confirmed: true };
  const gate = createSupportGate({ enabled, scope, language, now: () => at,
    send: event => commands.push(event), log: row => logs.push(row), makeId: () => String(++sequence) });
  const idle = () => gate.playback({ idle: true, version: sequence++ });
  function intro() {
    gate.native({ type: 'session.started' });
    gate.boundary({ type: 'origen.selection.delivery', stage: 'receipt', deliveryMode: 'conditional_recap' });
    gate.native({ type: 'session.output_transcript.delta', delta: 'Hello.' });
    gate.boundary({ type: 'response.output_audio_transcript.done', response_id: 'intro', transcript: 'Hello.' });
    idle();
  }
  function request(kind = 'starting_point', id = `question-${sequence++}`) {
    gate.native({ type: 'session.input_transcript.delta', delta: 'A support request.' });
    gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: 'A support request.' });
    idle();
    return { stamp: gate.stamp(), record: { status: 'completed', operationId: `op-${id}`, studentId: scope.studentId,
      callId: scope.sessionId, sourceTranscriptIds: [`user:${id}`], result: { supportNeed: kind, alreadyAddressed: false,
        selectedProbability: 0.99, confidence: 0.96, addressedProbability: 0.01,
        predicates: { research_relevant_now: { observed: true }, comparison_mismatch: { observed: true } } } } };
  }
  return { gate, commands, logs, scope, intro, request, idle, advance: ms => { at += ms; } };
}

for (const language of ['en', 'es']) for (const kind of ['starting_point', 'simpler_explanation', 'next_step'])
  test(`${language} ${kind} sends one fixed quiet note after intro and distinguishes acknowledgment from hearing`, () => {
    const f = fixture(language); f.intro(); const candidate = f.request(kind);
    assert.equal(f.gate.consider(candidate).sent, true);
    const [command] = f.commands;
    assert.equal(command.type, 'session.thinking.append'); assert.equal(command.delegation_id, null);
    assert.equal(command.content, SUPPORT_NOTES[language][kind]);
    assert.equal(command.content.includes('fictional-student'), false);
    assert.ok(command.content.length < 700);
    f.gate.native({ type: 'session.thinking.appended', client_event_id: command.event_id, start_ms: 15, end_ms: 30 });
    assert.equal(f.logs.at(-1).type, 'support_context_acknowledged');
    assert.equal(f.logs.at(-1).playbackClaim, false);
    assert.equal(f.gate.consider(candidate).reason, 'duplicate');
    assert.equal(f.commands.length, 1);
  });

test('default off and unfinished intro do not inject anything', () => {
  const off = fixture('en', false); off.intro(); assert.equal(off.gate.consider(off.request()).reason, 'disabled');
  const f = fixture(); f.gate.native({ type: 'session.started' });
  assert.equal(f.gate.consider(f.request()).reason, 'intro_unready');
  assert.equal(f.commands.length + off.commands.length, 0);
});

test('an initially confirmed session can finish its supplied intro without a selection receipt', () => {
  const f = fixture(); f.gate.native({ type: 'session.started' });
  f.gate.native({ type: 'session.output_transcript.delta', delta: 'Welcome back.' });
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Welcome back.' });
  f.idle(); assert.equal(f.gate.status().introReady, true);
  assert.equal(f.gate.consider(f.request()).sent, true);
});

test('an unconfirmed-to-confirmed scope cannot unlock on a quick acknowledgment without a receipt', () => {
  const f = fixture(); f.gate.configure({ ...f.scope, studentId: 'unselected', confirmed: false }, 'en');
  f.gate.native({ type: 'session.started' });
  f.gate.configure(f.scope, 'en');
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course, Aiden.' });
  f.idle(); assert.equal(f.gate.status().selectionPending, true);
  assert.equal(f.gate.consider(f.request()).reason, 'intro_unready');
  f.gate.boundary({ type: 'origen.selection.delivery', stage: 'receipt', deliveryMode: 'conditional_recap' });
  f.idle(); assert.equal(f.gate.status().introReady, false);
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'You were exploring college.' });
  f.idle(); assert.equal(f.gate.consider(f.request()).sent, true);
});

test('research observations, low confidence, matched scope, and possibly answered support are not cues', () => {
  for (const mutate of [r => { r.result.supportNeed = 'none'; }, r => { r.result.supportNeed = 'research_relevant_now'; },
    r => { r.result.selectedProbability = 0.89; }, r => { r.result.confidence = 0.84; },
    r => { r.result.alreadyAddressed = true; }, r => { r.result.addressedProbability = 0.11; },
    r => { r.status = 'discarded'; }, r => { r.studentId = 'other'; }, r => { r.sourceTranscriptIds = []; }]) {
    const f = fixture(); f.intro(); const c = f.request(); mutate(c.record);
    assert.equal(f.gate.consider(c).sent, false); assert.equal(f.commands.length, 0);
  }
});

test('late decision cannot enter after speech, a new question, brief append, handoff, or disconnect', () => {
  for (const change of [f => f.gate.native({ type: 'session.input_transcript.delta', delta: 'Actually...' }),
    f => f.gate.native({ type: 'session.output_transcript.delta', delta: 'Let us start...' }),
    f => f.gate.native({ type: 'session.output_audio.delta', delta: 'audio' }),
    f => f.request('next_step'),
    f => f.gate.providerCommand({ type: 'session.thinking.append', event_id: 'brief', content: 'Brief.' }),
    f => f.gate.configure({ ...f.scope, studentId: 'different' }, 'en'), f => f.gate.suspend(), f => f.gate.close()]) {
    const f = fixture(); f.intro(); const c = f.request(); change(f);
    assert.equal(f.gate.consider(c).sent, false); assert.equal(f.commands.length, 0);
  }
});

test('fresh idle and four-second question expiry are required, without delayed delivery', () => {
  const f = fixture(); f.intro(); const c = f.request(); f.advance(1501);
  assert.equal(f.gate.consider(c).reason, 'playback_not_fresh_idle');
  f.advance(2500); f.idle(); assert.equal(f.gate.consider(c).reason, 'expired');
  assert.equal(f.commands.length, 0);
});

test('active research, delegation and pending appends fence acknowledgment side effects', () => {
  for (const lock of [f => f.gate.researchBusy(true), f => f.gate.delegationBusy(true),
    f => f.gate.boundary({ type: 'origen.backend.started', response_id: 'backend' }),
    f => f.gate.providerCommand({ type: 'session.commentary.append', event_id: 'research-result' })]) {
    const f = fixture(); f.intro(); lock(f); const c = f.request();
    assert.equal(f.gate.consider(c).reason, 'background_or_context_pending');
    assert.equal(f.commands.length, 0);
  }
});

test('two-per-call cap and cooldown do not produce queued or repeated notes', () => {
  const f = fixture(); f.intro(); assert.equal(f.gate.consider(f.request()).sent, true);
  f.gate.native({ type: 'session.thinking.appended', client_event_id: f.commands[0].event_id });
  assert.equal(f.gate.consider(f.request()).reason, 'rate_limited');
  f.advance(30000); assert.equal(f.gate.consider(f.request()).sent, true);
  f.gate.native({ type: 'session.thinking.appended', client_event_id: f.commands[1].event_id });
  f.advance(30000); assert.equal(f.gate.consider(f.request()).reason, 'rate_limited');
  assert.equal(f.commands.length, 2);
});

test('scope change requires selection receipt, a new assistant boundary and idle playback', () => {
  const f = fixture(); f.intro(); f.gate.configure({ ...f.scope, studentId: 'second' }, 'es');
  assert.equal(f.gate.status().introReady, false); f.idle(); assert.equal(f.gate.status().introReady, false);
  f.gate.boundary({ type: 'response.output_audio_transcript.done', response_id: 'new-intro', transcript: 'Claro.' });
  f.idle(); assert.equal(f.gate.status().introReady, false);
  f.gate.boundary({ type: 'origen.selection.delivery', stage: 'receipt', deliveryMode: 'caller_first' });
  f.idle(); assert.equal(f.gate.status().introReady, false);
  f.gate.boundary({ type: 'response.output_audio_transcript.done', response_id: 'answer', transcript: 'Empecemos con eso.' });
  f.idle(); assert.equal(f.gate.status().introReady, true);
});

test('provider rejection is logged separately from context acknowledgment', () => {
  const f = fixture(); f.intro(); f.gate.consider(f.request());
  f.gate.native({ type: 'error', client_event_id: f.commands[0].event_id });
  assert.equal(f.logs.at(-1).type, 'support_provider_rejected'); assert.equal(f.logs.at(-1).playbackClaim, false);
});

test('last playback-busy sample after an assistant boundary does not keep intro locked forever', () => {
  const f = fixture(); f.gate.native({ type: 'session.started' });
  f.gate.boundary({ type: 'origen.selection.delivery', stage: 'receipt', deliveryMode: 'conditional_recap' });
  f.gate.native({ type: 'session.output_transcript.delta', delta: 'Hello.' });
  f.gate.boundary({ type: 'response.output_audio_transcript.done', response_id: 'intro', transcript: 'Hello.' });
  f.gate.playback({ idle: false, version: 10 });
  f.gate.playback({ idle: true, version: 11 });
  assert.equal(f.gate.status().introReady, true);
});

test('quick acknowledgment and context acknowledgment cannot unlock support before the recap', () => {
  const f = fixture(); f.gate.native({ type: 'session.started' });
  f.gate.boundary({ type: 'origen.selection.context', stage: 'staged' });
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course, Aiden.' });
  f.idle(); assert.equal(f.gate.status().introReady, false);
  assert.equal(f.gate.consider(f.request()).reason, 'intro_unready');
  f.gate.providerCommand({ type: 'session.thinking.append', event_id: 'brief' });
  f.gate.boundary({ type: 'origen.selection.delivery', stage: 'receipt', deliveryMode: 'conditional_recap' });
  f.gate.native({ type: 'session.thinking.appended', client_event_id: 'brief' });
  f.gate.boundary({ type: 'origen.selection.context', stage: 'acknowledged' });
  f.idle(); assert.equal(f.gate.status().introReady, false);
  assert.equal(f.gate.consider(f.request()).reason, 'intro_unready');
  f.gate.native({ type: 'session.output_transcript.delta', delta: 'You were thinking about college.' });
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'You were thinking about college.' });
  f.idle(); assert.equal(f.gate.status().introReady, true);
  assert.equal(f.gate.consider(f.request()).sent, true);
});

test('caller after selection receipt preserves the next normal answer before support is eligible', () => {
  const f = fixture(); f.intro();
  f.gate.boundary({ type: 'origen.selection.delivery', stage: 'caller_after_receipt', deliveryMode: 'caller_first' });
  f.idle(); assert.equal(f.gate.consider(f.request()).reason, 'intro_unready');
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Here is the answer to your question.' });
  f.idle(); assert.equal(f.gate.consider(f.request()).sent, true);
});

test('missing context acknowledgment logs uncertainty once and never clears the safety fence or retries', () => {
  const f = fixture(); f.intro(); f.gate.consider(f.request());
  f.advance(10000); f.gate.status(); f.gate.status();
  const unresolved = f.logs.filter(row => row.type === 'support_context_unconfirmed');
  assert.equal(unresolved.length, 1); assert.equal(unresolved[0].reason, 'acknowledgment_timeout');
  assert.equal(unresolved[0].playbackClaim, false);
  f.advance(30000); assert.equal(f.gate.consider(f.request()).reason, 'background_or_context_pending');
  assert.equal(f.commands.length, 1);
  f.gate.native({ type: 'session.thinking.appended', client_event_id: f.commands[0].event_id });
  assert.equal(f.logs.at(-1).type, 'support_context_acknowledged');
  assert.equal(f.gate.consider(f.request()).sent, true);
});

test('closing before an acknowledgment records unconfirmed delivery without claiming playback', () => {
  const f = fixture(); f.intro(); f.gate.consider(f.request()); f.gate.close();
  const unresolved = f.logs.find(row => row.type === 'support_context_unconfirmed');
  assert.equal(unresolved.reason, 'session_closed'); assert.equal(unresolved.playbackClaim, false);
  assert.equal(f.commands.length, 1);
});

test('one finished backend cannot clear another delegation awaiting its nested response', () => {
  const f = fixture(); f.intro();
  f.gate.native({ type: 'session.delegation.created', delegation: { id: 'first' } });
  f.gate.native({ type: 'response.event', delegation_id: 'first', event: { type: 'response.created', response: { id: 'r1' } } });
  f.gate.native({ type: 'session.delegation.created', delegation: { id: 'second' } });
  f.gate.boundary({ type: 'origen.backend.finished', response_id: 'r1' });
  assert.equal(f.gate.consider(f.request()).reason, 'background_or_context_pending');
  f.gate.native({ type: 'response.event', delegation_id: 'second', event: { type: 'response.created', response: { id: 'r2' } } });
  f.gate.boundary({ type: 'origen.backend.finished', response_id: 'r2' });
  assert.equal(f.gate.consider(f.request()).sent, true);
});
