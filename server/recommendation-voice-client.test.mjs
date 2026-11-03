import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationVoiceTools} from '../src/recommendationVoiceTools.mjs';
import {studentLiveChannel} from '../src/studentLiveChannel.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const item=(name,call_id=name,arguments_={})=>({name,call_id,arguments:JSON.stringify(arguments_)});
function fixture(extra={}){let sequence=1,turn={sessionId:'session',sequence:1,turnId:'request',transcript:'Save this step.'},saved=0,uncertain=0;const calls=[];
 const tools=recommendationVoiceTools({sequence:()=>sequence,evidence:async()=>turn,canHear:()=>true,post:async body=>{calls.push(body);return {status:body.action==='select'?'recommended':body.action==='prepare'?'readback_required':body.action==='confirm'?'saved':body.action==='verify'?'current':'observed',id:'preview',readback:'Complete action and privacy readback.'};},onSaved:()=>saved++,onUncertain:()=>uncertain++,...extra});tools.configure(true);
 return {tools,calls,saved:()=>saved,uncertain:()=>uncertain,turn(text){tools.begin();turn={...turn,sequence:++sequence,turnId:'turn-'+sequence,transcript:text};}};
}
function played(tools,mode='complete'){
 tools.event({type:'response.created',response:{id:'readback'}});
 if(mode!=='no-audio')tools.event({type:'output_audio_buffer.started',response_id:'readback'});
 tools.event({type:'response.output_audio_transcript.done',response_id:'readback',item_id:'one',transcript:'Complete action and privacy readback.'});
 if(mode==='interrupted')tools.event({type:'input_audio_buffer.speech_started'});
 if(mode==='cleared')tools.event({type:'output_audio_buffer.cleared'});
 tools.event({type:'response.done',response:{id:'readback',status:mode==='cancelled'?'cancelled':'completed'}});
 if(mode!=='no-drain')tools.event({type:'output_audio_buffer.stopped',response_id:'readback',...(mode==='forced'?{liveBoundary:'forced_flush'}:{})});
}
for(const mode of ['complete','no-audio','no-drain','interrupted','cleared','cancelled','forced','muted'])test('recommendation playback evidence: '+mode,async()=>{
 const f=fixture({canHear:()=>mode!=='muted'});await f.tools.invoke(item('prepare_recommendation_action'));played(f.tools,mode);await f.tools.settled();
 assert.equal(f.calls.filter(c=>c.action==='present'&&c.presentation).length,mode==='complete'?1:0);f.tools.stop();
});
test('new priority discards selection; model arguments cannot assert consent or select another action',async()=>{
 const f=fixture();await f.tools.invoke(item('suggest_next_action'));f.turn('I want to talk about classes instead.');await f.tools.spokenTurn();assert.equal(f.calls.at(-1).action,'cancel');
 for(const args of [{accepted:true},{presentation:'heard'},{studentId:'other'},{candidate:{}}])assert.equal((await f.tools.invoke(item('confirm_recommendation_action',JSON.stringify(args),args))).status,'invalid_request');
 f.tools.stop();
});
test('uncertain saves are deduplicated and never automatically retried or called saved',async()=>{
 let attempts=0;const f=fixture({post:async body=>{if(body.action==='confirm'){attempts++;throw Error('connection lost');}return {status:'current'};}}),call=item('confirm_recommendation_action');
 assert.equal((await f.tools.invoke(call)).status,'outcome_unknown');assert.equal((await f.tools.invoke(call)).status,'outcome_unknown');assert.equal(attempts,1);assert.equal(f.saved(),0);assert.equal(f.uncertain(),1);f.tools.stop();
});
test('late results after cancellation or scope change cannot reach the new turn',async()=>{
 let resolve;const f=fixture({post:async()=>new Promise(r=>resolve=r)}),result=f.tools.invoke(item('suggest_next_action'));await tick();f.turn('Another question');resolve({status:'recommended',id:'late'});assert.equal((await result).status,'cancelled');f.tools.stop();
});
test('Live adapter requires observed audio and drain for recommendation readbacks',async()=>{
 for(const mode of ['audible','forced','silent']){
  const f=fixture();await f.tools.invoke(item('prepare_recommendation_action'));const scheduled=new Map();let next=0;
  const raw={send(){},close(){},readyState:'open'},channel=studentLiveChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>mode==='silent'?0:1,schedule:(fn,ms)=>{const id=++next;scheduled.set(id,{fn,ms});return id;},cancel:id=>scheduled.delete(id)});
  channel.configure({voiceProvider:'live',voiceSession:{tools:[]}});channel.onmessage=({data})=>f.tools.event(JSON.parse(data));raw.onmessage({data:JSON.stringify({type:'session.output_transcript.delta',delta:'Complete action and privacy readback.'})});await tick();
  if(mode==='forced')await channel.flush();else{const idle=[...scheduled.values()].find(x=>x.ms===1800);assert.ok(idle);idle.fn();}
  await tick();await f.tools.settled();assert.equal(f.calls.filter(c=>c.action==='present'&&c.presentation).length,mode==='audible'?1:0);channel.close();f.tools.stop();
 }
});
