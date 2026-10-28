import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createBudget,responseReservation,usageCostUpper,wav,pcmFromWav,syntheticTool,EventStream,LIMITS,replaceLedger,recoverLedger,CAMPAIGN} from '../scripts/evaluate-live-voice-prompts.mjs';
import {liveVoicePromptCases,allSpeechInputs} from '../evals/live-voice-prompts.cases.mjs';

test('budget reserves before work, survives unknown usage and counts retries',async()=>{
 let writes=0;const entries=[],budget=createBudget(5,entries,async()=>writes++);
 const first=await budget.reserve('response',3);assert.equal(writes,1);assert.equal(budget.total(),3);
 await budget.settle(first,null);assert.equal(budget.total(),3);
 await assert.rejects(()=>budget.reserve('retry',2.01),/budget_boundary/);
 await budget.settle(first,1);assert.equal(budget.total(),1);
 await budget.reserve('retry',4);assert.equal(budget.total(),5);
 assert.throws(()=>createBudget(5.01),/at_most_5/);
 assert.equal(createBudget(5,entries).total(),5);
});

test('usage ignores cache discounts and charges unknown reasoning at highest rate',()=>{
 assert.equal(usageCostUpper(null),null);
 assert.equal(usageCostUpper({input_tokens:100,output_tokens:50,input_token_details:{text_tokens:40,audio_tokens:60,cached_tokens:90},output_token_details:{text_tokens:10,audio_tokens:30}}),(40*4+60*32+10*24+40*64)/1e6);
 const reserve=responseReservation({configBytes:60000,inputSeconds:150,priorOutputTokens:10000,responses:20});
 assert.ok(reserve>usageCostUpper({input_tokens:20000,output_tokens:1500,input_token_details:{text_tokens:15000,audio_tokens:5000},output_token_details:{audio_tokens:1500}}));
});

test('budget underestimation is recorded honestly and fails closed',async()=>{
 const budget=createBudget(5);const entry=await budget.reserve('response',0.1);
 await assert.rejects(()=>budget.settle(entry,0.11),/reservation_exceeded/);assert.equal(budget.total(),0.11);assert.equal(entry.status,'reservation_exceeded');
});

test('atomic ledger replacement retries only bounded Windows sharing violations',async()=>{
 const waits=[];let attempts=0;
 await replaceLedger('temporary','target',{renameFile:async()=>{if(++attempts<3)throw Object.assign(Error('sharing violation'),{code:attempts===1?'EPERM':'EBUSY'});},wait:async ms=>waits.push(ms)});
 assert.equal(attempts,3);assert.deepEqual(waits,[50,100]);
 attempts=0;waits.length=0;
 await assert.rejects(()=>replaceLedger('temporary','target',{renameFile:async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EPERM'});},wait:async ms=>waits.push(ms)}),/locked/);
 assert.equal(attempts,4);assert.deepEqual(waits,[50,100,200]);
 attempts=0;
 await assert.rejects(()=>replaceLedger('temporary','target',{renameFile:async()=>{attempts++;throw Object.assign(Error('missing'),{code:'ENOENT'});},wait:async()=>assert.fail('unexpected retry')}),/missing/);
 assert.equal(attempts,1);
});

test('stale ledger recovery preserves superset IDs and maximum charges after a crash',()=>{
 const entry=(id,accountedUSD,reservedUSD=1)=>({id,kind:'response',accountedUSD,reservedUSD,status:'reserved'});
 const ledger=entries=>({kind:'live-voice-prompts-cumulative-budget',campaign:CAMPAIGN,date:'2026-10-28',capUSD:5,entries});
 const main=ledger([entry('first',0.4)]),pending=ledger([entry('first',0.1),entry('second',0.7)]);
 const recovered=recoverLedger(main,pending);assert.equal(recovered.entries.length,2);assert.equal(recovered.entries[0].accountedUSD,0.4);assert.equal(recovered.accountedCostUpperUSD,1.1);
 assert.equal(recoverLedger(pending,main).entries.length,2);assert.ok(Math.abs(recoverLedger(null,pending).accountedCostUpperUSD-0.8)<1e-12);
 assert.throws(()=>recoverLedger(main,{...pending,campaign:'other-campaign'}),/incompatible/);
 assert.throws(()=>recoverLedger(main,ledger([entry('unrelated',0.1)])),/divergent/);
 assert.throws(()=>recoverLedger(main,ledger([entry('first',0.1),entry('first',0.2)])),/invalid_budget_ledger_entry/);
 assert.throws(()=>recoverLedger(ledger([entry('first',4)]),ledger([entry('first',4),entry('second',2)])),/budget_boundary/);
 assert.equal(main.entries[0].accountedUSD,0.4);assert.equal(pending.entries[0].accountedUSD,0.1);
});

test('WAV parsing rejects incompatible sample rates and accepts streaming lengths',()=>{
 const pcm=Buffer.alloc(48000,3),file=wav(pcm);assert.deepEqual(pcmFromWav(file),pcm);
 const invalid=Buffer.from(file);invalid.writeUInt32LE(48000,24);assert.throws(()=>pcmFromWav(invalid),/24khz/);
 const streaming=Buffer.from(file);streaming.writeUInt32LE(0xffffffff,4);streaming.writeUInt32LE(0xffffffff,40);assert.deepEqual(pcmFromWav(streaming),pcm);
});

test('synthetic profile save requires current explicit spoken request and keeps corrections',()=>{
 const state={profile:{name:'Alex'},failFirstSave:true},call={name:'save_onboarding_profile',arguments:'{"requested_by_user":true}'};
 for(const text of ['Thanks.','Do not save my profile yet.','Gracias. Todavía no guardes mi perfil.'])assert.equal(syntheticTool(call,state,text).result.status,'save_not_requested');
 syntheticTool({name:'propose_profile',arguments:'{"changes":[{"field":"name","value":"Alexis"}]}'},state,'');
 assert.equal(syntheticTool(call,state,'Guarda mi perfil ahora.').result.status,'save_failed');assert.equal(state.saved,undefined);
 const saved=syntheticTool(call,state,'Guarda mi perfil ahora.').result;assert.equal(saved.status,'saved');assert.equal(saved.persisted,false);assert.equal(state.saved.name,'Alexis');
});

test('every provider tool reply explicitly identifies nonpersistent evaluation adapter',()=>{
 for(const name of ['lookup_financial_aid','propose_profile','end_conversation']){
  const output=syntheticTool({name,arguments:'{}'},{profile:{}},'').result;
  assert.equal(output.syntheticEvaluationAdapter,true);assert.equal(output.persisted,false);
 }
});

test('fixtures cover both languages, interruption, onboarding and scope without real identifiers',()=>{
 assert.equal(liveVoicePromptCases.length,LIMITS.sessions);assert.equal(allSpeechInputs().length,25);
 for(const language of ['en','es']){
  const cases=liveVoicePromptCases.filter(c=>c.language===language);assert.equal(cases.length,3);
  assert.ok(cases.some(c=>c.turns.some(t=>t.interrupt)));assert.ok(cases.some(c=>c.onboarding));assert.ok(cases.some(c=>c.routeConversations&&c.closeFault));
 }
});

test('free preflight works without any prior output audio directory',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-voice-preflight-'));
 try{
  const script=fileURLToPath(new URL('../scripts/evaluate-live-voice-prompts.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[script],{cwd:directory,encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);const preflight=JSON.parse(run.stdout);
  assert.equal(preflight.paidCalls,false);assert.equal(preflight.scenarios.length,6);assert.ok(preflight.newSpeechReservationUSD>0);
 }finally{await rmdir(directory);}
});

test('socket waits fail on provider errors and close without reconnection',async()=>{
 class FakeSocket extends EventTarget {readyState=WebSocket.OPEN;closeCount=0;send(){}close(){this.closeCount++;this.readyState=WebSocket.CLOSED;queueMicrotask(()=>this.dispatchEvent(Object.assign(new Event('close'),{code:1000,reason:'test',wasClean:true})));}}
 const socket=new FakeSocket(),record={},stream=new EventStream(socket,record);
 const waiting=stream.wait(e=>e.type==='never',{timeout:100});stream.push({type:'error',error:{code:'test_failure'}});await assert.rejects(waiting,/test_failure/);
 await stream.close();await stream.close();assert.equal(socket.closeCount,1);assert.equal(record.socketClosed,true);
});
