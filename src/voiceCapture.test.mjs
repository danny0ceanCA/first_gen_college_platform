import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceCapture} from './voiceCapture.mjs';
import {validateCapture} from '../server/private-voice-capture.mjs';

const scope={subject:'synthetic',sessionId:'00000000-0000-4000-8000-000000000001',attemptId:'00000000-0000-4000-8000-000000000002'};
const partial=n=>({type:'response.output_audio_transcript.delta',response_id:'reply',delta:`word ${n}`});
async function drain(archive){for(let i=0;i<40;i++)await archive.flush();}
function reconstructed(rows){
 const groups=Map.groupBy(rows.filter(row=>row.data.type==='capture.fragment'),row=>row.data.fragmentId);
 return [...groups.values()].map(group=>{
  group.sort((a,b)=>a.data.index-b.data.index);
  assert.equal(group.length,group[0].data.count,'every transmitted fragment group must be complete');
  return JSON.parse(group.map(row=>row.data.text).join(''));
 });
}

test('slow uploads preserve context, final transcripts and closure evidence ahead of partial transcript bursts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const saved=[],archive=createVoiceCapture(async rows=>saved.push(...structuredClone(rows)));
 archive.enable(true);
 const instructions='Synthetic context. '.repeat(2000);
 archive.event({type:'context.received',instructions},scope);
 archive.event({type:'response.output_audio_transcript.done',response_id:'reply',transcript:'Final answer'},scope);
 archive.event({type:'diagnostic',event:'connection_failure_detail',details:{closeCode:1008}},scope);
 for(let i=0;i<400;i++)archive.event(partial(i),scope);
 await drain(archive);
 assert.equal(reconstructed(saved)[0].instructions,instructions);
 assert.ok(saved.some(row=>row.data.text==='Final answer'));
 assert.ok(saved.some(row=>row.data.event==='connection_failure_detail'));
 assert.ok(saved.length<=128);
 const dropped=saved.filter(row=>row.data.type==='capture.gap').reduce((n,row)=>n+row.data.dropped,0);
 assert.equal(saved.filter(row=>row.data.partial).length+dropped,400);
 assert.equal(saved.filter(row=>row.data.type==='capture.gap').length,1,'aggregate losses instead of adding a marker for every delta');
});

test('a partially uploaded context finishes intact despite subsequent pressure and a failed upload',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let release,fail=true;const attempts=[],saved=[];
 const archive=createVoiceCapture(async rows=>{
  attempts.push(structuredClone(rows));
  if(fail){await new Promise(resolve=>{release=resolve;});throw Error('offline');}
  saved.push(...structuredClone(rows));
 });
 archive.enable(true);
 const instructions='Context with Unicode á 漢. '.repeat(6000);
 archive.event({type:'context.received',instructions},scope);
 const first=archive.flush();
 for(let i=0;i<400;i++)archive.event(partial(i),scope);
 archive.event({type:'response.output_audio_transcript.done',transcript:'Complete'},scope);
 release();await first;fail=false;
 await drain(archive);
 assert.deepEqual(attempts[0],attempts[1],'retry exactly the failed batch, including IDs and immutable payloads');
 assert.equal(reconstructed(saved)[0].instructions,instructions);
 assert.ok(saved.some(row=>row.data.text==='Complete'));
 for(const batch of attempts){assert.ok(Buffer.byteLength(JSON.stringify(batch))<=48000);validateCapture({action:'append',events:batch});}
 const losses=saved.filter(row=>row.data.type==='capture.gap').reduce((n,row)=>n+row.data.dropped,0);
 assert.equal(saved.filter(row=>row.data.partial).length+losses,400);
 assert.ok(saved.length<=128);
});

test('pressure discards a whole unsent fragmented event instead of publishing an unreconstructable tail',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const saved=[],archive=createVoiceCapture(async rows=>saved.push(...structuredClone(rows)));
 archive.enable(true);
 archive.event({type:'context.received',instructions:'old '.repeat(40000)},scope);
 for(let i=0;i<126;i++)archive.event({type:'response.done',response:{status:'completed'}},scope);
 await drain(archive);
 assert.equal(saved.filter(row=>row.data.type==='capture.fragment').length,0);
 assert.ok(saved.some(row=>row.data.type==='capture.gap'&&row.data.dropped>1));
 assert.equal(saved.filter(row=>row.data.type==='response.done').length,126);
});

test('retrying a loss marker never changes its acknowledged identity or silently loses new overflow',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const attempts=[],saved=[];let failed=false,recovered=false;
 const archive=createVoiceCapture(async rows=>{
  attempts.push(structuredClone(rows));
  if(!recovered&&rows.some(row=>row.data.type==='capture.gap')){failed=true;throw Error('offline');}
  saved.push(...structuredClone(rows));
 });
 archive.enable(true);
 for(let i=0;i<200;i++)archive.event(partial(i),scope);
 for(let i=0;i<40&&!failed;i++)await archive.flush();
 assert.ok(failed);const failedBatch=attempts.at(-1);
 for(let i=0;i<300;i++)archive.event(partial(i),scope);
 await archive.flush();assert.deepEqual(attempts.at(-1),failedBatch);
 recovered=true;await drain(archive);
 const losses=saved.filter(row=>row.data.type==='capture.gap').reduce((n,row)=>n+row.data.dropped,0);
 assert.equal(saved.filter(row=>row.data.partial).length+losses,500);
});
