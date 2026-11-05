// Real Chromium/WebRTC loopback, entirely synthetic. No microphone, account,
// OpenAI calls, STUN/TURN servers, production API, or application server needed.
// Uses the existing cached Playwright CLI; does not install browser/packages.
// Run: node scripts/audio-diagnostics-browser-smoke.mjs
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifact=join(root,'output/playwright/audio-diagnostics-loopback');
const session=`audio-diagnostics-${process.pid}`;
const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const npxCli=join(dirname(npmCli),'npx-cli.js');
const html=`<!doctype html><html><head><title>Synthetic audio diagnostics</title></head><body><button id="start">Run local loopback</button><p id="status">Ready</p><script type="module">
import {startLiveAudioDiagnostics} from '/src/liveAudioDiagnostics.mjs';
import {createVoiceCapture} from '/src/voiceCapture.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(condition,message)=>{if(!condition)throw Error(message);};
async function until(predicate,ms=10000){const end=performance.now()+ms;while(performance.now()<end){if(await predicate())return;await delay(100);}throw Error('Loopback condition timed out');}
async function gather(pc){if(pc.iceGatheringState==='complete')return;await until(()=>pc.iceGatheringState==='complete');}
async function run(){
 const events=[],batches=[],sender=new RTCPeerConnection({iceServers:[]}),receiver=new RTCPeerConnection({iceServers:[]});
 const context=new AudioContext(),audio=new Audio();audio.autoplay=true;audio.muted=true;document.body.append(audio);
 const archive=createVoiceCapture(async batch=>{batches.push(batch);});archive.enable(true);
 const scope={subject:'synthetic-audio-only',sessionId:crypto.randomUUID(),attemptId:crypto.randomUUID()};
 const monitor=startLiveAudioDiagnostics({pc:receiver,audio,enabled:true,intervalMs:1000,maxSamples:12,getAudioContextState:()=>context.state,onEvent:(event,details)=>{events.push({event,details});archive.event({type:'diagnostic',event,details},scope);}});
 let oscillator;
 try{
  await context.resume();const output=context.createMediaStreamDestination(),gain=context.createGain();gain.gain.value=.03;
  oscillator=context.createOscillator();oscillator.frequency.value=220;oscillator.connect(gain);gain.connect(output);oscillator.start();
  receiver.ontrack=event=>{audio.srcObject=event.streams[0];void audio.play();};
  for(const track of output.stream.getTracks())sender.addTrack(track,output.stream);
  await sender.setLocalDescription(await sender.createOffer());await gather(sender);await receiver.setRemoteDescription(sender.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());await gather(receiver);await sender.setRemoteDescription(receiver.localDescription);
  await until(()=>receiver.connectionState==='connected');
  await until(async()=>{let received=false;(await receiver.getStats()).forEach(row=>{if(row.type==='inbound-rtp'&&row.kind==='audio'&&row.packetsReceived>0)received=true;});return received;});
  await monitor.sample();await delay(1300);await monitor.sample();
  const samples=events.filter(event=>event.event==='audio_transport_sample'),active=samples.flatMap(event=>event.details.inbound).filter(stream=>stream.totals.packetsReceived>0);
  check(active.length>=2,'Expected two real inbound RTP samples');
  check(active.some(stream=>stream.delta.packetsReceived>0),'Expected a positive packet interval');
  check(events.some(event=>event.event==='audio_playback_event'&&event.details.operation==='playing'),'Expected browser media playing event');
  check(events.some(event=>event.event==='audio_track_event'&&event.details.operation==='attached'),'Expected remote audio track observation');
  monitor.stop();const stoppedCount=events.length;
  audio.pause();audio.dispatchEvent(new Event('waiting'));receiver.close();sender.close();oscillator.stop();await context.close();await delay(1300);
  check(events.length===stoppedCount,'Diagnostics continued after cleanup');await archive.flush();
  const archived=batches.flat();check(archived.filter(entry=>entry.data.event==='audio_transport_sample').length===samples.length,'Audio samples were not preserved by private batch archive');
  check(archived.every(entry=>entry.sessionId===scope.sessionId&&entry.attemptId===scope.attemptId),'Archive lost call scope');
  return {passed:true,browser:'Chromium',syntheticAudio:true,microphoneUsed:false,externalServicesUsed:false,physicalPlaybackAudited:false,sampleCount:samples.length,inboundSampleCount:active.length,positivePacketIntervals:active.filter(stream=>stream.delta.packetsReceived>0).length,maxJitterMs:Math.max(...active.map(stream=>stream.jitterMs||0)),archiveBatches:batches.length,archivedSamples:samples.length,mediaPlayingObserved:true,remoteTrackObserved:true,callbacksAfterStop:events.length-stoppedCount};
 }finally{monitor.stop();sender.close();receiver.close();try{oscillator?.stop();}catch{}if(context.state!=='closed')await context.close();audio.remove();await archive.flush();}
}
document.querySelector('#start').onclick=()=>{document.querySelector('#status').textContent='Running';window.audioSmokeDone=run().catch(error=>({passed:false,error:error.message})).then(async result=>{window.audioSmokeResult=result;document.querySelector('#status').textContent=result.passed?'Passed':'Failed';await fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)});return result;});};
</script></body></html>`;

function cli(args,timeoutMs=45000){
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[npxCli,'--offline','--package','@playwright/cli','playwright-cli','--session',session,...args],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',settled=false;const timer=setTimeout(()=>{child.kill();finish(1,true);},timeoutMs);
  const finish=(code,timedOut=false)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code,output,timedOut});};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(output.length<20000)output+=chunk.toString();});
  child.on('error',()=>finish(1));child.on('close',code=>finish(code??1));
 });
}

await mkdir(artifact,{recursive:true});let result,opened=false;
const server=createServer(async(req,res)=>{
 try{
  if(req.method==='POST'&&req.url==='/result'){let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Result exceeded limit');}result=JSON.parse(body);res.writeHead(204).end();return;}
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'}).end(html);return;}
  if(['/src/liveAudioDiagnostics.mjs','/src/voiceCapture.mjs'].includes(req.url)){res.writeHead(200,{'content-type':'application/javascript'}).end(await readFile(join(root,req.url.slice(1))));return;}
  res.writeHead(404).end();
 }catch{res.writeHead(400).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const origin=`http://127.0.0.1:${server.address().port}`;
 const runFile=join(artifact,'run.js');
 await writeFile(runFile,`async page=>{let blocked=0;await page.route('**/*',route=>{if(new URL(route.request().url()).origin===${JSON.stringify(origin)})return route.continue();blocked++;return route.abort();});await page.goto(${JSON.stringify(origin)});await page.getByRole('button',{name:'Run local loopback'}).click();await page.waitForFunction(()=>!!window.audioSmokeResult,{},{timeout:25000});const result=await page.evaluate(()=>window.audioSmokeDone);if(blocked)throw Error('External request attempted');if(!result.passed)throw Error(result.error);return result;}`);
 const launch=await cli(['open','about:blank']);opened=launch.code===0;
 if(!opened)result={passed:false,status:'browser_unavailable',diagnostic:launch.output.slice(-2500)};
 else{
  const run=await cli(['run-code','--filename',runFile]);
  if(run.code!==0||!result?.passed)result={...result,passed:false,status:'failed',diagnostic:run.output.slice(-2500)};
 }
}finally{if(opened)await cli(['close'],15000);await new Promise(resolve=>server.close(resolve));}
await writeFile(join(artifact,'result.json'),JSON.stringify({...result,completedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify(result,null,2));if(!result?.passed)process.exitCode=1;
