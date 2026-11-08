// Explicit, isolated WebRTC voice validation. Never imports a database or Render client.
// Cached audio contains fictional examples; no real account records are loaded.
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
const focused = process.argv.includes('--focused-support');
const budgetPath = resolve(LOCAL, 'support-voice-budget.json');
const reportPath = resolve(LOCAL, focused ? 'support-live-focused-validation.json' : 'support-live-validation.json');
const audioRoot = resolve(ROOT, 'tmp/unified-guide-cap5-en/audio');
const cap = 1.5, reserveUsd = .30, maxSeconds = 90;
const modes = focused ? ['support'] : ['baseline', 'support'];
const languages = ['en', 'es'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const audioText = {
  en: { essay: 'Aiden feels he has no interesting experiences for his personal insight questions. How can I encourage him?', simplify: 'That sounds like a lot. Could you make it simpler and give me just one gentle question to ask him?', simple: 'Can you say that more simply?' },
  es: { essay: 'Aiden siente que no tiene experiencias interesantes para las preguntas de reflexión personal. ¿Cómo puedo animarlo?', simplify: 'Eso suena a mucho. ¿Puedes simplificarlo y darme una sola pregunta amable para hacerle?', simple: '¿Puedes decirlo más sencillo?' },
};
const audioPath = (language, step) => step === 'simple' ? resolve(ROOT, `tmp/conversation-first-final-cap2/audio/${language}-simple.wav`) : resolve(audioRoot, `${language}-${step}.wav`);
for (const language of languages) for (const step of Object.keys(audioText[language])) {
  if (!existsSync(audioPath(language, step))) throw Error('cached_fictional_audio_missing');
}
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ preflight: true, voiceBudgetUsd: cap, maxSeconds, runs: languages.length * modes.length,
    noDatabase: true, ttsCalls: 0, fictionalOnly: true, command: 'node research/decisions/local-call/validate-live.mjs --execute' }));
  process.exit(0);
}
const key = loadEnv('development', ROOT, '').OPENAI_API_KEY;
if (!key) throw Error('local_openai_key_required');
const packagePath = process.env.ORIGEN_PLAYWRIGHT_PACKAGE || 'C:/Users/danie/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/package.json';
const { chromium } = createRequire(packagePath)('playwright');
await mkdir(LOCAL, { recursive: true });
let budget;
try { budget = JSON.parse(await readFile(budgetPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; budget = { capUsd: cap, authorization: 'New $3 local support approval: $1.50 voice allocation; separate fixed $1.50 Decisions ledger.', reservations: [] }; }
if (budget.capUsd !== cap) throw Error('voice_budget_mismatch');
const saveBudget = () => writeFile(budgetPath, JSON.stringify(budget, null, 2));
async function reserve(label) {
  const held = budget.reservations.reduce((sum, item) => sum + (item.settledUsd ?? item.reservedUsd), 0);
  if (held + reserveUsd > cap + 1e-8) throw Error('voice_budget_exhausted');
  const reservation = { id: randomUUID(), label, reservedUsd: reserveUsd, maxSeconds, at: new Date().toISOString() };
  budget.reservations.push(reservation); await saveBudget(); return reservation;
}
const report = { startedAt: new Date().toISOString(), fictionalOnly: true, noDatabase: true, ttsCalls: 0,
  pricingSource: 'https://developers.openai.com/api/docs/models/gpt-live-1', voiceCapUsd: cap,
  sourceHashes: Object.fromEntries(['support.mjs', 'session.mjs', 'worker.mjs'].map(name => [name, hash(readFileSync(new URL(name, import.meta.url), 'utf8'))])),
  evidenceLimits: 'Browser audio RMS proves media activity, not intelligibility or human perception. Native transcript evidence is separate. No manual cue injection or simulated classifier result is used.', runs: [] };
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
      { localOnly: true, fictional: true, seed, allowedCallIds: [run.callId], supportEnabled: run.mode === 'support', paid: run.mode === 'support', apiKey: key });
      if (!await run.engine.observation.ready) throw Error('observer_not_ready');
      run.socket.on('message', rawEvent => { const event = JSON.parse(rawEvent); run.events.push({ at: Date.now(), ...event }); run.engine.receive(event);
        if (event.type === 'session.delegation.created' && ++run.delegations > 6) void closeRun(run);
      });
      run.engine.start(); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ sdp: data.transport.sdp }));
    } catch (error) { active.errors.push(error.message); response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const language of languages) for (const mode of modes) {
    const reservation = await reserve(`${language}-${mode}`);
    const run = { language, mode, callId: 'support-voice-' + randomUUID(), startedAt: Date.now(), events: [], sent: [], application: [], errors: [], turns: [], researchAttempts: 0, delegations: 0 };
    active = run;
    const page = await browser.newPage();
    const guard = setTimeout(() => void closeRun(run), maxSeconds * 1000);
    try {
      await page.exposeFunction('audioPlayback', value => { run.engine?.playback({ idle: value.idle, version: value.version }); });
      await page.exposeFunction('captureAudio', bytes => writeFile(resolve(LOCAL, run.callId + '.webm'), Buffer.from(bytes)));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#start').click();
      await page.waitForFunction(() => window.proof.connected, null, { timeout: 30000 });
      run.introRequestedAt = Date.now();
      run.engine.command({ type: 'response.create', response: { metadata: { topic: 'origen_opening' } } });
      async function waitAnswer(after, label) {
        const started = Date.now(); let first;
        while (Date.now() - started < 30000 && !run.closing) {
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
      run.gateAfterIntro = run.engine.observation.status().support;
      for (const step of ['essay', focused ? 'simple' : 'simplify']) {
        if (run.closing) break;
        const input = await page.evaluate(step => window.speak(step), step);
        const { endedAt: inputEndedAt, ...inputDetails } = input;
        run.turns.push({ ...inputDetails, inputEndedAt, expectedInput: audioText[language][step], ...await waitAnswer(inputEndedAt, step) });
      }
      await pause(2000);
      run.gateAfterTurns = run.engine.observation.status().support;
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
