// Explicit, isolated confusion and continuation WebRTC validation. No database or Render client.
// Fictional synthetic caller audio; ordinary voice answers are never held for Decisions.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import WebSocket from 'ws';
import { voiceSession } from '../../../server/profile-voice.mjs';
import { studentLiveSession } from '../../../server/student-live-session.mjs';
import { createCostLedger } from '../../../server/admin-voice-cost.mjs';
import { createObservedLocalSession } from './session.mjs';
import { createMicrophoneBudget, MICROPHONE_BUDGET_FILE } from './microphone-budget.mjs';
import { nextTestTurnMayStart } from './validation-quiet-window.mjs';
import { turnDeliveryEvidence } from './validation-turn-evidence.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCAL = resolve(ROOT, 'research/decisions/.local');
const budgetPath = resolve(LOCAL, 'approved-meaningful-live-20261108-three-dollar.json');
const stopPath = resolve(LOCAL, 'meaningful-live-stop.request');
const reportPath = resolve(LOCAL, 'meaningful-conversation-live-' + Date.now() + '.json');
const artifactRoot = resolve(ROOT, 'output/playwright/early-decisions');
const args = process.argv.slice(2);
if (args.some(arg => !['--execute', '--early-retest'].includes(arg)) || new Set(args).size !== args.length) throw Error('unsupported_argument');
const cap = 3, maxSeconds = 180, reserveUsd = .40;
const earlyRetest = args.includes('--early-retest');
const modes = earlyRetest ? ['early'] : ['shadow', 'early', 'late'], languages = ['en', 'es'];
const classifierSummary = () => {
  const ledger = createMicrophoneBudget({ budgetPath: resolve(LOCAL, MICROPHONE_BUDGET_FILE), microphoneBudgetApproved: true });
  try { return ledger.summary(); } finally { ledger.close(); }
};
const allocation = () => ({ authorization: 'Approved $3 for bilingual live validation on November 8, 2026',
  voiceCapUsd: cap, classifierLedger: MICROPHONE_BUDGET_FILE,
  classifierCharge: 'Decisions use the separate approved $5 ledger; report per-call usage separately from the $3 voice cap.',
  noNewTtsCalls: true, noDatabase: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const audioText = {
  en: {
    confusion: 'I am confused about grants and loans. I have been reading a college letter with my family, and I cannot work out which money would have to be paid back later.',
    followup: 'So if that money is a loan, would my family have to pay it back later? I am trying to understand what that means for us.',
    resolved: 'Okay, I understand the difference now. Let us change topics. How could Aiden explore different majors without feeling rushed to decide?',
    ordinary: 'He likes helping people and also likes writing. What is one small thing he could try first?',
  },
  es: {
    confusion: 'Me confunden las becas y los préstamos. He estado leyendo una carta de la universidad con mi familia, y no logro entender qué dinero tendríamos que devolver después.',
    followup: 'Entonces, si ese dinero es un préstamo, ¿mi familia tendría que devolverlo después? Estoy tratando de entender lo que significa para nosotros.',
    resolved: 'Ahora sí entiendo la diferencia. Cambiemos de tema. ¿Cómo podría Aiden explorar diferentes carreras sin sentir presión para decidir ya?',
    ordinary: 'A él le gusta ayudar a la gente y también escribir. ¿Qué cosa pequeña podría probar primero?',
  },
};
const steps = Object.keys(audioText.en);
const audioPath = (language, step) => resolve(artifactRoot, language + '-' + step + '-' + hash(audioText[language][step]).slice(0, 12) + '.wav');
const classifierBudget = classifierSummary();
const maximumClassifierRequests = languages.length * modes.length * 32;
const classifierReady = classifierBudget.maxRequests - classifierBudget.requestCount >= maximumClassifierRequests
  && classifierBudget.availableUsd >= classifierBudget.reservationUsd;
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ preflight: true, allocation: allocation(), voiceBudgetUsd: cap, maxSeconds, runs: languages.length * modes.length,
    classifierReady, classifierBudget, maximumClassifierRequests,
    noDatabase: true, maxNewTtsCalls: 0, cachedAudioReady: languages.every(language => steps.every(step => existsSync(audioPath(language, step)))), fictionalOnly: true,
    command: 'node research/decisions/local-call/validate-meaningful-live.mjs --execute' + (earlyRetest ? ' --early-retest' : '') }));
  process.exit(0);
}
if (!classifierReady) throw Error('insufficient_decisions_request_allowance');
if (existsSync(stopPath)) throw Error('explicit_stop_request_present');
const key = loadEnv('development', ROOT, '').OPENAI_API_KEY;
if (!key) throw Error('local_openai_key_required');
const packagePath = process.env.ORIGEN_PLAYWRIGHT_PACKAGE || 'C:/Users/danie/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/package.json';
const { chromium } = createRequire(packagePath)('playwright');
await mkdir(LOCAL, { recursive: true });
await mkdir(artifactRoot, { recursive: true });
const lockPath = budgetPath + '.lock';
const lock = openSync(lockPath, 'wx');
closeSync(lock);
process.once('exit', () => { try { unlinkSync(lockPath); } catch {} });
let budget;
try { budget = JSON.parse(await readFile(budgetPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; budget = { capUsd: cap, authorization: allocation().authorization, reservations: [] }; }
if (budget.capUsd !== cap || !Array.isArray(budget.reservations)
  || budget.reservations.some(item => !Number.isFinite(item.reservedUsd) || item.reservedUsd <= 0
    || item.usageComplete === true && (!Number.isFinite(item.settledUsd) || item.settledUsd < 0))) throw Error('voice_budget_mismatch');
const saveBudget = async () => {
  const temporary = budgetPath + '.pending';
  await writeFile(temporary, JSON.stringify(budget, null, 2));
  await rename(temporary, budgetPath);
};
async function reserve(label, amount = reserveUsd) {
  const classifierBefore = classifierSummary();
  const held = budget.reservations.reduce((sum, item) => sum + (item.usageComplete === true ? item.settledUsd : item.reservedUsd), 0);
  if (held + amount > cap + 1e-8) throw Error('voice_validation_budget_exhausted');
  const reservation = { id: randomUUID(), label, voiceReservedUsd: amount,
    reservedUsd: amount, classifierBefore, maxSeconds, at: new Date().toISOString() };
  budget.reservations.push(reservation); await saveBudget(); return reservation;
}
const report = { startedAt: new Date().toISOString(), fictionalOnly: true, noDatabase: true, ttsCalls: 0,
  comparisonScope: earlyRetest ? 'Development retest after caller-input delivery fence: English and Spanish early-only against prior six-condition baseline. Same prerecorded input and voice/session configuration; not a randomized causal study.' : 'Early support shadow-only vs preanswer-enabled vs separately opt-in late-enabled. Existing preferences and conversation-support paths stay identical; shadow is not all Decisions disabled.',
  baselineComparisonReport: earlyRetest ? 'meaningful-conversation-live-1794156760697.json' : null,
  scriptedUserReactionsNotOutcomeEvidence: true,
  allocation: allocation(), answerTimeoutMs: 45000, steps, scenario: earlyRetest ? 'four-turn-bilingual-early-delivery-development-retest' : 'four-turn-bilingual-shadow-early-late-comparison',
  pricingSource: 'https://developers.openai.com/api/docs/models/gpt-live-1', voiceCapUsd: cap,
  sourceHashes: Object.fromEntries(['validate-meaningful-live.mjs', 'validation-quiet-window.mjs', 'validation-turn-evidence.mjs', 'support.mjs', 'early-support-delivery.mjs', 'early-projector.mjs', 'early-need-context.mjs', 'early-evaluator.mjs', 'early-rubric.mjs', 'explanation-history.mjs', 'microphone-budget.mjs', 'conversation-delivery.mjs', 'session.mjs', 'worker.mjs', 'projector.mjs', '../observer.mjs'].map(name => [name, hash(readFileSync(new URL(name, import.meta.url), 'utf8'))])),
  evidenceLimits: 'Small synthetic three-condition comparison, not causal proof or a human warmth assessment. Same application startup and voice configuration; local early cue delivery is shadow, early-only, or experimental late-enabled. Language order counterbalances conditions. Fictional confirmed student, no database or research. Browser RMS is playback activity, not intelligibility. Native transcript intervals remain separate. Provider context receipt does not prove adaptation. No manual cues or mocked classifier results. The model directly hears confusion too. Optional support never holds native audio.', runs: [] };
const missingAudio = languages.flatMap(language => steps.map(step => ({ language, step }))).filter(({ language, step }) => !existsSync(audioPath(language, step)));
if (missingAudio.length) throw Error('cached_fictional_audio_required_no_tts_authorized_by_harness');
let browser, server, active, stopRequested = false, stopMonitor;
const configByLanguage = earlyRetest
  ? new Map(JSON.parse(readFileSync(resolve(LOCAL, report.baselineComparisonReport), 'utf8')).runs.map(run => [run.language, run.configHash]))
  : new Map();

const html = `<!doctype html><button id="start">Start isolated test</button><script>
window.proof={playback:[],inputs:[],errors:[],connected:false};let pc,dc,ctx,dest,monitor,recorder,chunks=[],version=0,lastHot=0,lastIdle;
window.stop=async()=>{clearInterval(monitor);if(recorder?.state==='recording'){await new Promise(r=>{recorder.onstop=r;recorder.stop();});const a=await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer();await window.captureAudio(Array.from(new Uint8Array(a)));}pc?.close();await ctx?.close();};
document.querySelector('button').onclick=async()=>{
 ctx=new AudioContext();dest=ctx.createMediaStreamDestination();await ctx.resume();const zero=ctx.createConstantSource(),gain=ctx.createGain();gain.gain.value=0;zero.connect(gain);gain.connect(dest);zero.start();
 pc=new RTCPeerConnection();dest.stream.getTracks().forEach(t=>pc.addTrack(t,dest.stream));
 pc.onconnectionstatechange=()=>{proof.connected=pc.connectionState==='connected';};
 pc.ontrack=e=>{const a=new Audio();a.srcObject=e.streams[0];a.play().catch(error=>proof.errors.push(error.message));
  recorder=new MediaRecorder(e.streams[0]);recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.start(250);
  const analyser=ctx.createAnalyser(),samples=new Float32Array(analyser.fftSize);ctx.createMediaStreamSource(e.streams[0]).connect(analyser);
  monitor=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length),at=Date.now();if(rms>.004)lastHot=at;const idle=at-lastHot>500;
   if(idle!==lastIdle){version++;lastIdle=idle;}const value={idle,version,at,rms};proof.playback.push(value);window.audioPlayback(value).catch(()=>{});},100);
 };
 dc=pc.createDataChannel('events');dc.onmessage=message=>{try{const event=JSON.parse(message.data);if(event.type==='error')proof.errors.push(event.error?.code||event.type);}catch{}};
 const offer=await pc.createOffer();await pc.setLocalDescription(offer);const response=await fetch('/start',{method:'POST',body:JSON.stringify({sdp:offer.sdp})});const data=await response.json();if(!response.ok)throw Error(data.error||'start_failed');await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
};
window.speak=async(step)=>{const source=ctx.createBufferSource();source.buffer=await ctx.decodeAudioData(await(await fetch('/audio?step='+step)).arrayBuffer());source.connect(dest);const record={step,startedAt:Date.now(),durationMs:source.buffer.duration*1000};proof.inputs.push(record);source.start();await new Promise(resolve=>source.onended=resolve);record.endedAt=Date.now();return record;};
</script>`;

async function closeRun(run) {
  if (run.closing) return; run.closing = true;
  if (run.socket?.readyState === WebSocket.OPEN) run.socket.send(JSON.stringify({ type: 'session.close', event_id: randomUUID() }));
  const deadline = Date.now() + 2500;
  while (!run.events.some(event => event.type === 'session.closed') && Date.now() < deadline) await pause(50);
  run.engine?.close(); await run.engine?.observation.closed;
  run.socket?.close();
}

function requestStop() {
  stopRequested = true;
  if (active && !active.closing) { active.operatorStopRequested = true; void closeRun(active); }
}
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
stopMonitor = setInterval(() => { if (existsSync(stopPath)) requestStop(); }, 250);
stopMonitor.unref();

try {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); return; }
      if (url.pathname === '/audio') {
        const step = url.searchParams.get('step'); if (!Object.hasOwn(audioText[active.language], step)) throw Error('invalid_audio');
        response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(await readFile(audioPath(active.language, step))); return;
      }
      if (url.pathname !== '/start' || request.method !== 'POST') { response.writeHead(404).end(); return; }
      const run = active; if (run.requested) throw Error('duplicate_session'); run.requested = true;
      let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 200000) throw Error('request_too_large'); }
      const { sdp } = JSON.parse(raw);
      const input = { mode: 'planning', role: 'parent', language: run.language, studentId: 'fictional-aiden', targetConfirmed: true,
        voiceProtocol: 'live-v1', voiceControlProtocol: 'server-v1', profile: { name: 'Aiden' },
        caller: { firstName: 'Morgan' }, experience: { usedApp: true, usedVoice: true } };
      const config = voiceSession(input, { OPENAI_MODEL_VOICE: 'gpt-live-1' });
      const session = studentLiveSession(config, input, [], { ORIGEN_LIVE_SERVER_CONTROL: 'true' });
      if (session.model !== 'gpt-live-1' || session.delegation?.type !== 'responses'
        || session.delegation.responses?.model !== 'gpt-6-luna'
        || session.delegation.responses?.max_output_tokens > 1800
        || session.delegation.responses?.tools?.some(tool => tool.type !== 'function'))
        throw Error('unexpected_paid_session_configuration');
      if (JSON.stringify(session).length > 80000) throw Error('voice_config_budget_bound');
      run.configHash = hash(session); run.introRequestedAt = null;
      if (configByLanguage.has(run.language) && configByLanguage.get(run.language) !== run.configHash)
        throw Error('voice_configuration_changed_between_conditions');
      configByLanguage.set(run.language, run.configHash);
      run.providerRequestStarted = true;
      const upstream = await fetch('https://api.openai.com/v1/live/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }), signal: AbortSignal.timeout(25000) });
      const data = await upstream.json(); if (!upstream.ok) throw Error(`voice_create_${upstream.status}_${data.error?.code ?? 'unknown'}`);
      run.providerSessionId = data.session.id;
      run.socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${data.session.id}/attach`, { headers: { Authorization: `Bearer ${key}` } });
      run.socket.on('error', () => { run.errors.push('sideband_error'); });
      await Promise.race([once(run.socket, 'open'), pause(10000).then(() => { throw Error('sideband_open_timeout'); })]);
      const seed = { fictional: true, accountId: 'fictional-support-validation', callId: run.callId, studentId: input.studentId, language: run.language, role: 'family' };
      run.engine = createObservedLocalSession({ provider: { get readyState() { return run.socket.readyState; }, send(text) { const event = JSON.parse(text); run.sent.push({ at: Date.now(), ...event }); run.socket.send(text); } },
        providerSessionId: run.providerSessionId, scope: { sessionId: run.callId, studentId: input.studentId, confirmed: true },
        config: { ...config, language: run.language, requestedVoice: 'marin' },
        emit(event) { run.application.push({ at: Date.now(), ...event });
          if (event.controlLease) for (const item of event.response?.output ?? []) if (item.type === 'function_call') {
            run.engine.command({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ status: 'unavailable_in_isolated_voice_validation', instruction: 'Continue conversationally without changing records.' }) } }, event.controlLease);
          }
        }, jobRequest() { run.researchAttempts++; throw Error('research_disabled_for_support_validation'); } },
      { localOnly: true, fictional: true, seed, allowedCallIds: [run.callId], supportEnabled: true, preferencesEnabled: true, conversationEnabled: true,
        earlyEnabled: true, earlyObserveOnly: run.mode === 'shadow', lateEnabled: run.mode === 'late',
        microphoneBudgetApproved: true, paid: true, apiKey: key });
      if (!await run.engine.observation.ready) throw Error('observer_not_ready');
      run.socket.on('message', rawEvent => { const event = JSON.parse(rawEvent);
        const recorded = { at: Date.now(), ...event };
        // Browser MediaRecorder holds the audio artifact. The event report keeps
        // PCM evidence without duplicating megabytes of base64 payloads.
        if (event.type === 'session.output_audio.delta' && typeof event.delta === 'string') {
          const bytes = Buffer.from(event.delta, 'base64');
          recorded.audioPayloadBytes = bytes.length;
          recorded.audioPayloadAllZero = bytes.every(byte => byte === 0);
          delete recorded.delta;
        }
        if (event.type === 'session.input_audio.append') { delete recorded.audio; delete recorded.delta; }
        run.events.push(recorded); run.engine.receive(event);
        if (event.type === 'session.delegation.created' && ++run.delegations > 6) void closeRun(run);
        if (event.type === 'response.event' && event.event?.type === 'response.created'
          && ++run.backendResponses > 12) { run.errors.push('backend_response_safety_limit'); void closeRun(run); }
      });
      run.engine.start(); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ sdp: data.transport.sdp }));
    } catch (error) { active.errors.push(error.message);
      if (typeof error.cause?.code === 'string') active.errors.push('setup_transport_' + error.cause.code);
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
  runs: for (const language of languages) for (const mode of (language === 'es' ? [...modes].reverse() : modes)) {
    if (stopRequested || existsSync(stopPath)) break runs;
    const reservation = await reserve(`${language}-${mode}`);
    const run = { language, mode, callId: 'meaningful-voice-' + randomUUID(), startedAt: Date.now(), events: [], sent: [], application: [], errors: [], turns: [], researchAttempts: 0, delegations: 0, backendResponses: 0 };
    active = run;
    const page = await browser.newPage();
    const guard = setTimeout(() => void closeRun(run), maxSeconds * 1000);
    try {
      await page.exposeFunction('audioPlayback', value => { run.engine?.playback({ idle: value.idle, version: value.version }); });
      await page.exposeFunction('captureAudio', bytes => writeFile(resolve(artifactRoot, run.callId + '.webm'), Buffer.from(bytes)));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#start').click();
      await page.waitForFunction(() => window.proof.connected, null, { timeout: 30000 });
      run.introRequestedAt = Date.now();
      run.engine.command({ type: 'response.create', response: { metadata: { topic: 'origen_opening' } } });
      async function waitAnswer(after, label) {
        const started = Date.now(); let first;
        while (Date.now() - started < 45000 && !run.closing) {
          const playback = await page.evaluate(() => window.proof.playback);
          const hot = playback.filter(value => value.at >= after && value.rms > .004);
          const text = run.events.filter(event => event.type === 'session.output_transcript.delta' && event.at >= after);
          if (hot.length) first ??= hot[0].at;
          if (text.length && hot.length && Date.now() - hot.at(-1).at > 2000) return { label, firstAudioMs: first - after, text: text.map(event => event.delta).join(''), outputEndedAt: hot.at(-1).at };
          await pause(100);
        }
        throw Error(`${label}_answer_timeout`);
      }
      async function waitForListeningGap(since) {
        const notBefore = Date.now() + 3000;
        while (!run.closing) {
          const playback = await page.evaluate(() => window.proof.playback);
          if (nextTestTurnMayStart({ now: Date.now(), notBefore, since, playback, events: run.events })) return;
          await pause(100);
        }
      }
      run.intro = await waitAnswer(run.introRequestedAt, 'intro');
      await waitForListeningGap(run.introRequestedAt);
      run.gateAfterIntro = run.engine.observation.status();
      for (const step of steps) {
        if (run.closing) break;
        const input = await page.evaluate(step => window.speak(step), step);
        const { endedAt: inputEndedAt, ...inputDetails } = input;
        run.turns.push({ ...inputDetails, inputEndedAt, expectedInput: audioText[language][step], ...await waitAnswer(inputEndedAt, step) });
        // The simulated caller takes a short ordinary pause after hearing the
        // full answer. This never holds, cancels or requests model output.
        await waitForListeningGap(inputEndedAt);
        // Include speech that resumed during the simulated caller's pause.
        run.turns.at(-1).text = run.events.filter(event => event.type === 'session.output_transcript.delta'
          && event.at >= inputEndedAt).map(event => event.delta).join('');
        run.turns.at(-1).gateAfterQuiet = run.engine.observation.status();
      }
      // A brief quiet patch is not proof of a finished spoken answer. On the
      // final turn, keep collecting both transcript and browser audio until
      // both have been quiet for ten seconds. Never infer semantic completion;
      // the independent hard call limit remains in force.
      const drainStartedAt = Date.now();
      while (!run.closing && Date.now() - drainStartedAt < 30000) {
        const playback = await page.evaluate(() => window.proof.playback);
        const lastHot = playback.filter(value => value.rms > .004).at(-1)?.at ?? drainStartedAt;
        const lastText = run.events.filter(event => event.type === 'session.output_transcript.delta' && event.delta).at(-1)?.at ?? drainStartedAt;
        if (Date.now() - Math.max(lastHot, lastText) >= 10000) break;
        await pause(100);
      }
      run.finalDrain = { elapsedMs: Date.now() - drainStartedAt, hardLimitReached: !!run.closing,
        completionEvidence: 'transcript_and_browser_quiet_estimate_not_semantic_completion' };
      await pause(2000);
      run.gateAfterTurns = run.engine.observation.status();
    } catch (error) { run.errors.push(error.message.split('\n')[0]); }
    finally {
      clearTimeout(guard); await closeRun(run); await page.evaluate(() => window.stop()).catch(() => {});
      run.browser = await page.evaluate(() => window.proof).catch(() => null); await page.close();
      run.turns.forEach((turn,index) => { turn.deliveryEvidence=turnDeliveryEvidence(turn, {
        nextInputStartedAt: run.turns[index+1]?.startedAt ?? Infinity, events: run.events, playback: run.browser?.playback ?? [] }); });
      const ledger = createCostLedger('gpt-live-1'); run.events.forEach(event => ledger.ingest(event)); run.cost = ledger.snapshot(true, !!run.providerSessionId);
      if (run.providerRequestStarted !== true) { run.cost.complete = true; run.cost.total = 0; run.cost.noProviderRequest = true; }
      const classifierAfter = classifierSummary();
      reservation.classifierAfter = classifierAfter;
      const classifierChargeUsd = Math.max(0, classifierAfter.spentUsd + classifierAfter.reservedUsd
        - reservation.classifierBefore.spentUsd - reservation.classifierBefore.reservedUsd);
      reservation.classifierChargeUsd = classifierChargeUsd;
      reservation.settledUsd = run.cost.complete ? run.cost.total : reservation.voiceReservedUsd;
      reservation.voiceUsageComplete = run.cost.complete;
      // Decisions stay in their separate approved durable ledger. Missing
      // voice final usage keeps the full voice reservation held here.
      reservation.usageComplete = run.cost.complete;
      run.classifierBudget = { before: reservation.classifierBefore, after: classifierAfter, chargeUsd: classifierChargeUsd };
      await saveBudget();
      try { run.observerRecords = readFileSync(resolve(LOCAL, run.callId + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch { run.observerRecords = []; }
      run.supportDeliveryEvidence = run.sent.filter(event => event.type === 'session.thinking.append').map(event => {
        const receipt = run.events.find(candidate => candidate.type === 'session.thinking.appended'
          && candidate.client_event_id === event.event_id);
        const afterReceipt = receipt ? run.events.filter(candidate => candidate.type === 'session.output_transcript.delta'
          && candidate.at >= receipt.at && candidate.at < receipt.at + 15000) : [];
        return { eventId: event.event_id, sentAt: event.at, receiptAt: receipt?.at ?? null,
          receiptDelayMs: receipt ? receipt.at - event.at : null, content: event.content,
          subsequentOutputEventIds: afterReceipt.map(item => item.event_id),
          evidenceLimit: 'Context receipt and subsequent transcript only; not proof of audible adaptation or causation.' };
      });
      run.unsolicitedContinuationReview = {
        finalCallerInputEnd: run.turns.at(-1)?.inputEndedAt ?? null,
        finalDrain: run.finalDrain ?? null,
        extraResponseCommandsAfterOpening: run.sent.filter(event => event.type === 'response.create').length,
        evidenceLimit: 'Review audio and transcript after each cue for repeated or unsolicited speech; a quiet interval is not semantic completion.' };
      delete run.engine; delete run.socket;
      report.runs.push(run); await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ language, mode, introMs: run.intro?.firstAudioMs, turns: run.turns.map(turn => ({ step: turn.step, firstAudioMs: turn.firstAudioMs })), errors: run.errors,
        reportPath, quietAppends: run.sent.filter(event => event.type === 'session.thinking.append').length,
        voiceCostUsd: run.cost.total, classifierChargeUsd, chargedUsd: reservation.settledUsd, completeUsage: run.cost.complete }));
    }
  }
} finally {
  clearInterval(stopMonitor);
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  report.runtimeUnchanged = Object.entries(report.sourceHashes).every(([name, expected]) => hash(readFileSync(new URL(name, import.meta.url), 'utf8')) === expected);
  report.finishedAt = new Date().toISOString(); await writeFile(reportPath, JSON.stringify(report, null, 2));
  await unlink(lockPath).catch(() => {});
}
