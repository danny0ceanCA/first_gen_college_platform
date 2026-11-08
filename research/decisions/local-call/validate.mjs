// Explicit fictional transcript validation; no microphone, voice API or research.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createObservedLocalSession } from './session.mjs';

if(!process.argv.includes('--real-decisions'))throw Error('explicit_real_decisions_flag_required');
if(!process.env.ORIGEN_DECISIONS_TEST_KEY)throw Error('dedicated_test_key_required');
for(const language of ['en','es']){
 const callId='fictional-3a-'+randomUUID(),seed={fictional:true,accountId:'fictional-account',callId,studentId:'fictional-student',language,role:'family'};
 const engine=createObservedLocalSession({provider:{send(){}},scope:{sessionId:callId,studentId:seed.studentId,confirmed:true},
  config:{language,tools:[]},emit(){},jobRequest(){throw Error('no_research');}},
  {localOnly:true,fictional:true,seed,allowedCallIds:[callId],paid:true,apiKey:process.env.ORIGEN_DECISIONS_TEST_KEY});
 const file=new URL(`../.local/${callId}.jsonl`,import.meta.url);
 const records=()=>{try{return readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);}catch{return [];}};
 async function waitFor(count){const start=Date.now();while(Date.now()-start<18000){if(records().filter(r=>r.type==='decision_observation').length>=count)return;await new Promise(r=>setTimeout(r,50));}throw Error('observation_timeout');}
 try{
  if(!await engine.observation.ready)throw Error('worker_unavailable');
  engine.start();
  engine.receive({type:'session.input_transcript.delta',delta:language==='es'?'¿Nos ayudas a saber por dónde empezar con la universidad?':'Could you help us figure out where to begin with college?',start_ms:0,end_ms:1000});
  await engine.flush();await waitFor(1);
  engine.receive({type:'session.output_transcript.delta',delta:language==='es'?'Pueden empezar preguntándole qué le gustaría aprender. Elijan una cosa que le dé curiosidad.':'You can start by asking what they would enjoy learning. Choose one thing they are curious about.',start_ms:1100,end_ms:2100});
  await new Promise(resolve=>setImmediate(resolve));
  engine.playback({idle:true,version:1});await engine.flush();await waitFor(2);
 }finally{engine.close();await engine.observation.closed;}
 const observations=records().filter(r=>r.type==='decision_observation');
 if(observations.length!==2||observations.some(r=>r.status!=='completed'||r.result?.supportNeed!=='starting_point')
   ||observations[0].result.alreadyAddressed!==false||observations[1].result.alreadyAddressed!==true)throw Error('unexpected_observation');
 console.log(JSON.stringify({language,callId,observations:observations.map(r=>({status:r.status,result:r.result,durationMs:r.durationMs,reason:r.reason})),voiceApiCalls:0,intervention:false}));
}
