// Explicit, isolated confusion and continuation WebRTC validation. No database or Render client.
// Fictional synthetic caller audio; ordinary voice answers are never held for Decisions.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
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

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCAL = resolve(ROOT, 'research/decisions/.local');
const budgetPath = resolve(LOCAL, 'continuation-voice-budget.json');
const smoke = process.argv.includes('--smoke');
const refinement = process.argv.includes('--refine');
const finishSpanish = process.argv.includes('--finish-spanish');
if (finishSpanish && !refinement) throw Error('spanish_completion_requires_refinement_budget');
const reportPath = resolve(LOCAL, finishSpanish ? 'continuation-live-spanish-completion.json' : refinement ? 'continuation-live-refinement.json' : smoke ? 'continuation-live-smoke.json' : 'continuation-live-validation.json');
const artifactRoot = resolve(ROOT, 'output/playwright/continuation');
// Preserve the same conservative per-second reservation for the shorter
// completion run. Failed/unknown setup reservations are never released here.
const cap = 2.5, maxSeconds = finishSpanish ? 85 : smoke ? 105 : 150;
const reserveUsd = finishSpanish ? maxSeconds * .005 : .75;
const modes = ['continuation'];
const languages = finishSpanish ? ['es'] : ['en', 'es'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const audioText = {
  en: {
    confusion: 'I do not understand what financial aid means. Could we start with one simple idea?',
    stillConfused: 'That is still confusing. I do not really understand the difference.',
    offer: 'Before you explain more, could you ask me if I would like an example?',
    accept: 'Yes, please.',
    change: 'Now I understand. Let us change topics. How could Aiden start choosing a major?',
  },
  es: {
    confusion: 'No entiendo qué significa ayuda financiera. ¿Podemos empezar con una idea sencilla?',
    stillConfused: 'Todavía me confunde. No entiendo bien la diferencia.',
    offer: 'Antes de explicar más, ¿puedes preguntarme si quiero un ejemplo?',
    accept: 'Sí, por favor.',
    change: 'Ahora entiendo. Cambiemos de tema. ¿Cómo puede Aiden empezar a elegir una carrera?',
  },
};
const steps = finishSpanish ? ['offer', 'accept', 'change'] : smoke ? ['confusion', 'offer', 'accept'] : Object.keys(audioText.en);
const audioPath = (language, step) => resolve(artifactRoot, language + '-' + step + '-' + hash(audioText[language][step]).slice(0, 12) + '.wav');
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ preflight: true, voiceBudgetUsd: cap, maxSeconds, runs: languages.length * modes.length,
    noDatabase: true, maxNewTtsCalls: 10, ttsReserveUsd: .10, fictionalOnly: true,
    command: 'node research/decisions/local-call/validate-conversation-live.mjs --execute' }));
  process.exit(0);
}
const key = loadEnv('development', ROOT, '').OPENAI_API_KEY;
if (!key) throw Error('local_openai_key_required');
const packagePath = process.env.ORIGEN_PLAYWRIGHT_PACKAGE || 'C:/Users/danie/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/package.json';
const { chromium } = createRequire(packagePath)('playwright');
await mkdir(LOCAL, { recursive: true });
await mkdir(artifactRoot, { recursive: true });
let budget;
try { budget = JSON.parse(await readFile(budgetPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; budget = { capUsd: cap, authorization: 'New $3 conversation validation approval: $2.50 voice allocation; separate immutable $0.50 Decisions ledger.', reservations: [] }; }
if (budget.capUsd !== cap) throw Error('voice_budget_mismatch');
const saveBudget = () => writeFile(budgetPath, JSON.stringify(budget, null, 2));
async function reserve(label, amount = reserveUsd) {
  const held = budget.reservations.reduce((sum, item) => sum + (item.settledUsd ?? item.reservedUsd), 0);
  if (held + amount > cap + 1e-8) throw Error('voice_budget_exhausted');
  const reservation = { id: randomUUID(), label, reservedUsd: amount, maxSeconds, at: new Date().toISOString() };
  budget.reservations.push(reservation); await saveBudget(); return reservation;
}
const report = { startedAt: new Date().toISOString(), fictionalOnly: true, noDatabase: true, ttsCalls: 0,
  finishSpanish, answerTimeoutMs: 45000, steps,
  pricingSource: 'https://developers.openai.com/api/docs/models/gpt-live-1', voiceCapUsd: cap,
  sourceHashes: Object.fromEntries(['support.mjs', 'conversation-delivery.mjs', 'conversation-candidates.mjs', 'research-terminal-state.mjs', 'session.mjs', 'worker.mjs', 'projector.mjs', 'support-routing.mjs', 'observer-budget.mjs', '../observer.mjs', '../conversation-rubric.mjs', '../conversation-evidence.mjs'].filter(name => existsSync(new URL(name, import.meta.url))).map(name => [name, hash(readFileSync(new URL(name, import.meta.url), 'utf8'))])),
  evidenceLimits: 'The offer turn explicitly requests an offer to exercise acceptance. Research terminal delivery is tested separately with fixtures, not a real official-source lookup. Browser audio RMS proves media activity, not intelligibility or human perception. Native transcript evidence is separate. No manual cue injection or simulated classifier result is used. The model directly hears the confusion and acceptance too: subsequent behavior cannot be attributed causally to Decisions from these two smoke tests. The per-call duration cap is a test safety bound; the final short-offer turn exercises conversational acceptance.', runs: [] };
const missingAudio = languages.flatMap(language => steps.map(step => ({ language, step }))).filter(({ language, step }) => !existsSync(audioPath(language, step)));
if (missingAudio.length) {
  const ttsReservation = await reserve('continuation-fictional-tts', .10);
  for (const { language, step } of missingAudio) {
    const input = audioText[language][step];
    if (input.length > 400) throw Error('tts_input_bound');
    report.ttsCalls++;
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input, response_format: 'wav' }), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw Error(`tts_failed_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.length > 5_000_000) throw Error('invalid_tts_wav');
    await writeFile(audioPath(language, step), bytes);
  }
  ttsReservation.usageComplete = false;
  ttsReservation.note = 'Audio speech does not report usage here; keep full reservation held. No automatic retry.';
  ttsReservation.characterCount = missingAudio.reduce((sum, { language, step }) => sum + audioText[language][step].length, 0);
  report.ttsEstimatedUsd = ttsReservation.characterCount * 15 / 1_000_000;
  await saveBudget();
}
let browser, server, active;

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
      if (JSON.stringify(session).length > 80000) throw Error('voice_config_budget_bound');
      run.configHash = hash(session); run.introRequestedAt = null;
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
        continuationRefinement: refinement, paid: true, apiKey: key });
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
      });
      run.engine.start(); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ sdp: data.transport.sdp }));
    } catch (error) { active.errors.push(error.message); response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const language of languages) for (const mode of modes) {
    const reservation = await reserve(`${language}-${mode}`);
    const run = { language, mode, callId: 'continuation-voice-' + randomUUID(), startedAt: Date.now(), events: [], sent: [], application: [], errors: [], turns: [], researchAttempts: 0, delegations: 0 };
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
      run.intro = await waitAnswer(run.introRequestedAt, 'intro');
      run.gateAfterIntro = run.engine.observation.status();
      for (const step of steps) {
        if (run.closing) break;
        const input = await page.evaluate(step => window.speak(step), step);
        const { endedAt: inputEndedAt, ...inputDetails } = input;
        run.turns.push({ ...inputDetails, inputEndedAt, expectedInput: audioText[language][step], ...await waitAnswer(inputEndedAt, step) });
        // The simulated caller takes a short ordinary pause after hearing the
        // full answer. This never holds, cancels or requests model output.
        await pause(3000);
        run.turns.at(-1).gateAfterQuiet = run.engine.observation.status();
      }
      await pause(2000);
      run.gateAfterTurns = run.engine.observation.status();
    } catch (error) { run.errors.push(error.message.split('\n')[0]); }
    finally {
      clearTimeout(guard); await closeRun(run); await page.evaluate(() => window.stop()).catch(() => {});
      run.browser = await page.evaluate(() => window.proof).catch(() => null); await page.close();
      const ledger = createCostLedger('gpt-live-1'); run.events.forEach(event => ledger.ingest(event)); run.cost = ledger.snapshot(true, !!run.providerSessionId);
      if (run.cost.complete) { reservation.settledUsd = run.cost.total; reservation.usageComplete = true; }
      else reservation.usageComplete = false;
      await saveBudget();
      try { run.observerRecords = readFileSync(resolve(LOCAL, run.callId + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch { run.observerRecords = []; }
      delete run.engine; delete run.socket;
      report.runs.push(run); await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ language, mode, introMs: run.intro?.firstAudioMs, turns: run.turns.map(turn => ({ step: turn.step, firstAudioMs: turn.firstAudioMs })), errors: run.errors,
        quietAppends: run.sent.filter(event => event.type === 'session.thinking.append').length, costUsd: run.cost.total, completeUsage: run.cost.complete }));
    }
  }
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString(); await writeFile(reportPath, JSON.stringify(report, null, 2));
}
