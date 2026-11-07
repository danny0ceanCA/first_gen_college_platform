import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundResearch} from './backgroundResearch.mjs';
import {voiceHandoff} from './voiceHandoff.mjs';
function fixture(){
 const timers=new Map(),delivered=[],removed=[];let seq=0,current=true,quiet=true,clock=0,status='running',reads=0;
 const queue=backgroundResearch({post:async()=>({id:'job'}),read:async()=>{reads++;return {id:'job',status,result:{answer:'Verified',sources:[]}}},remove:async id=>removed.push(id),isCurrent:()=>current,isQuiet:()=>quiet,deliver:x=>delivered.push(x),schedule:fn=>{timers.set(++seq,fn);return seq;},cancel:id=>timers.delete(id),now:()=>clock});
 return {queue,delivered,removed,setCurrent:v=>current=v,setQuiet:v=>quiet=v,setStatus:v=>status=v,setClock:v=>clock=v,reads:()=>reads,async tick(){const [id,fn]=timers.entries().next().value||[];if(fn){timers.delete(id);fn();await new Promise(r=>setImmediate(r));}}};
}

test('research status is accepted only after a job receipt, then follows real worker state',async()=>{
 let accept,tick,status='running';const states=[],delivered=[];
 const q=backgroundResearch({post:()=>new Promise(r=>accept=r),read:async()=>({status,result:{answer:'Verified'}}),remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:x=>delivered.push(x),onRequest:x=>states.push(x),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 const starting=q.start({requestKey:'native-call',question:'Santa Cruz published tuition; residency unknown',institution:'UC Santa Cruz',language:'en',mode:'finance',studentId:'student'});
 assert.equal(states.at(-1).state,'requesting');assert.equal(states.at(-1).jobId,null);
 accept({id:'real-job',status:'queued'});assert.equal((await starting).jobId,'real-job');
 assert.equal(states.at(-1).state,'queued');assert.equal(states.at(-1).requestId,'native-call');
 await tick();await new Promise(r=>setImmediate(r));assert.equal(states.at(-1).state,'running');
 status='completed';await tick();await new Promise(r=>setImmediate(r));
 assert.equal(states.at(-1).state,'completed');assert.equal(delivered.length,1);
 assert.ok(states.every(s=>s.question.includes('residency unknown')&&s.studentId==='student'));q.close();
});

test('a failed enqueue is never reported as an active lookup',async()=>{
 const states=[];const q=backgroundResearch({post:async()=>{throw Error('offline');},remove:async()=>{},onRequest:x=>states.push(x),isCurrent:()=>true,onState:()=>{}});
 await assert.rejects(q.start({question:'Costs',requestKey:'r'}));
 assert.deepEqual(states.map(s=>s.state),['requesting','failed']);assert.ok(states.every(s=>s.jobId===null));q.close();
});

test('a duplicate while enqueue is pending cannot fabricate an accepted job',async()=>{
 let accept,posts=0;const q=backgroundResearch({post:()=>{posts++;return new Promise(r=>accept=r);},remove:async()=>{},isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 const query={question:'Costs',institution:'UC Santa Cruz',studentId:'a'};
 const first=q.start(query),second=await q.start(query);
 assert.equal(posts,1);assert.equal(second.status,'research_requesting');assert.equal(second.jobId,undefined);
 accept({id:'accepted'});assert.equal((await first).jobId,'accepted');q.close();
});

test('duplicate accepted requests preserve their original job and scope',async()=>{
 let posts=0;const states=[];const q=backgroundResearch({post:async()=>({id:'job'+ ++posts}),remove:async()=>{},isCurrent:()=>true,isQuiet:()=>false,onRequest:x=>states.push(x),schedule:()=>1,cancel:()=>{}});
 const query={question:'Santa Cruz tuition',institution:'UC Santa Cruz',mode:'finance',language:'en',studentId:'a'};
 const first=await q.start({...query,requestKey:'first'}),second=await q.start({...query,requestKey:'repeat'});
 assert.equal(first.jobId,second.jobId);assert.equal(posts,1);assert.equal(states.at(-1).requestId,'first');q.close();
});

for(const language of ['en','es'])test(`${language}: rephrasing and a fresh flag cannot replace accepted research`,async()=>{
 const states=[],removed=[];let posts=0;
 const q=backgroundResearch({post:async()=>({id:'job'+ ++posts}),remove:async id=>removed.push(id),isCurrent:()=>true,onRequest:s=>states.push(s),schedule:()=>1,cancel:()=>{}});
 const first=await q.start({question:language==='en'?'Berkeley costs':'Costos de Berkeley',institution:'UC Berkeley',studentId:'a',requestKey:'first',language});
 const repeat=await q.start({question:language==='en'?'How much is that?':'¿Cuánto cuesta?',institution:'Berkeley',studentId:'a',requestKey:'other',language,forceRefresh:true});
 assert.equal(posts,1);assert.deepEqual(removed,[]);assert.equal(repeat.requestId,first.requestId);assert.equal(repeat.revision,1);assert.equal(repeat.jobId,first.jobId);q.close();
});
test('explicit current revision replaces research; stale revisions cannot replace it again',async()=>{
 const states=[],removed=[],delivered=[],timers=new Map();let posts=0;
 const q=backgroundResearch({post:async()=>({id:'job'+ ++posts}),remove:async id=>removed.push(id),read:async id=>({status:'completed',result:{text:id}}),isCurrent:()=>true,isQuiet:()=>true,deliver:x=>delivered.push(x),onRequest:s=>states.push(s),schedule:fn=>(timers.set(posts,fn),posts),cancel:id=>timers.delete(id)});
 const original=await q.start({question:'Berkeley',studentId:'a',requestKey:'first'}),oldPoll=timers.get(1);
 const replacement=await q.start({question:'Actually Davis',studentId:'a',requestKey:'second',replaceRequestId:original.requestId,replaceRevision:1});
 assert.equal(replacement.requestId,original.requestId);assert.equal(replacement.revision,2);assert.equal(posts,2);assert.deepEqual(removed,['job1']);
 const stale=await q.start({question:'Old correction',studentId:'a',replaceRequestId:original.requestId,replaceRevision:1});
 assert.equal(stale.status,'research_request_changed');assert.equal(stale.activeTask.revision,2);assert.equal(posts,2);
 oldPoll();await new Promise(r=>setImmediate(r));assert.equal(delivered.length,0);
 timers.get(2)();await new Promise(r=>setImmediate(r));assert.equal(delivered[0].result.text,'job2');assert.equal(delivered[0].revision,2);q.close();
});
test('a rephrased request while enqueueing shares the pending request without a fake receipt',async()=>{
 let accept,posts=0;const q=backgroundResearch({post:()=>{posts++;return new Promise(r=>accept=r);},remove:async()=>{},isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 const first=q.start({question:'Cost of attendance',requestKey:'first'});
 const duplicate=await q.start({question:'The published budget please',requestKey:'repeat'});
 assert.equal(posts,1);assert.equal(duplicate.status,'research_requesting');assert.equal(duplicate.requestId,'first');assert.equal(duplicate.jobId,undefined);
 accept({id:'accepted'});await first;q.close();
});
test('failed cancellation never claims server work stopped',async()=>{
 const q=backgroundResearch({post:async()=>({id:'j'}),remove:async()=>{throw Error('offline');},isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 await q.start({question:'Costs'});const result=await q.cancel();assert.equal(result.status,'research_cancellation_unconfirmed');q.close();
});
test('replacement identifiers cannot move a task into a different student scope',async()=>{
 let posts=0;const q=backgroundResearch({post:async()=>({id:'j'+ ++posts}),remove:async()=>{},isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 const first=await q.start({studentId:'a',sessionId:'call',question:'Costs'});
 const result=await q.start({studentId:'b',sessionId:'call',question:'Other student',replaceRequestId:first.requestId,replaceRevision:1});
 assert.equal(result.status,'research_scope_changed');assert.equal(posts,1);q.close();
});
test('cancelling an unacknowledged enqueue does not claim confirmed server cancellation',async()=>{
 let accept;const removed=[];const q=backgroundResearch({post:()=>new Promise(r=>accept=r),remove:async id=>removed.push(id),isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 const first=q.start({question:'Costs'});assert.equal((await q.cancel()).status,'research_cancellation_requested');
 accept({id:'late'});assert.equal((await first).status,'research_cancelled');assert.deepEqual(removed,['late']);q.close();
});

for(const status of [undefined,429,500,503])test(`temporary polling failure ${status} keeps the original job and recovers`,async()=>{
 let reads=0,tick;const delivered=[],removed=[];
 const q=backgroundResearch({post:async()=>({id:'original'}),read:async()=>{if(++reads<3)throw Object.assign(Error('temporary'),{status});return {status:'completed',result:{text:'Verified'}};},remove:async id=>removed.push(id),isCurrent:()=>true,isQuiet:()=>true,deliver:r=>delivered.push(r),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 await q.start({question:'Costs'});for(let n=0;n<3;n++){await tick();await new Promise(r=>setImmediate(r));}
 assert.equal(reads,3);assert.deepEqual(removed,[]);assert.equal(delivered.length,1);assert.equal(delivered[0].status,'completed');q.close();
});
for(const status of [401,403,404,405])test(`terminal polling failure ${status} is delivered once without a retry loop`,async()=>{
 let reads=0,tick;const delivered=[];
 const q=backgroundResearch({post:async()=>({id:'original'}),read:async()=>{reads++;throw Object.assign(Error('denied'),{status});},remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:r=>delivered.push(r),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 await q.start({question:'Costs'});for(let n=0;n<3;n++){await tick();await new Promise(r=>setImmediate(r));}
 assert.equal(reads,1);assert.equal(delivered.length,1);assert.equal(delivered[0].status,'failed');q.close();
});
for(const question of ['What does Berkeley cost?','¿Cuánto cuesta Berkeley?','What are the application requirements?','¿Cuáles son los requisitos para transferirse?'])test(`research returns immediately and survives ordinary clarification: ${question}`,async()=>{
 const f=fixture();const pending=await f.queue.start({question});assert.equal(pending.status,'research_pending');assert.equal(f.reads(),0);
 assert.match(pending.instruction,/Explain the useful concept or distinction already supported by known context now/);
 assert.match(pending.instruction,/only source-dependent facts must wait/);
 assert.match(pending.instruction,/carry the answer forward/);
 assert.match(pending.instruction,/do not re-ask an answered question/);
 f.setQuiet(false);await f.tick();assert.equal(f.removed.length,0);
 f.setStatus('completed');await f.tick();assert.equal(f.delivered.length,0);
 f.setQuiet(true);await f.tick();assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].question,question);f.queue.close();
});
test('scope changes discard completed evidence',async()=>{const f=fixture();await f.queue.start({question:'Costs'});f.setStatus('completed');f.setCurrent(false);await f.tick();assert.equal(f.delivered.length,0);assert.deepEqual(f.removed,['job']);});
test('cancel does not disable later research',async()=>{const f=fixture();await f.queue.start({question:'Costs'});f.queue.cancel();await f.tick();assert.equal(f.delivered.length,0);await f.queue.start({question:'Deadlines'});f.setStatus('completed');await f.tick();assert.equal(f.delivered[0].question,'Deadlines');});
test('close while enqueue is pending cancels the eventual job',async()=>{let finish;const removed=[];const f=backgroundResearch({post:()=>new Promise(r=>finish=r),remove:async id=>removed.push(id),isCurrent:()=>true,isQuiet:()=>true,deliver:()=>assert.fail()});const pending=f.start({question:'Costs'});f.close();finish({id:'late'});assert.equal((await pending).status,'research_cancelled');assert.deepEqual(removed,['late']);});
test('timeout cancels server work and reports failure once at a pause',async()=>{const f=fixture();await f.queue.start({question:'Costs'});f.setClock(120000);f.setQuiet(false);await f.tick();assert.equal(f.delivered.length,0);f.setQuiet(true);await f.tick();assert.equal(f.delivered[0].status,'failed');await f.tick();assert.equal(f.delivered.length,1);});
test('handoff separates pending caller speech from instructions in both languages',()=>{for(const q of ['What about Elodie?','¿Y Elodie?']){const text=voiceHandoff(q);assert.ok(text.endsWith(JSON.stringify(q)));assert.match(text,/never speak, paraphrase or role-play/);assert.match(text,/without asking for them again/);}});

for(const language of ['en','es'])test(`${language}: selecting covered scenarios preserves work even when replacement IDs were supplied`,async()=>{
 const posted=[],removed=[],delivered=[];let tick;
 const q=backgroundResearch({requireReplacementChange:true,post:async query=>(posted.push(query),{id:'original'}),read:async()=>({status:'completed',result:{text:'Verified comparison'}}),remove:async id=>removed.push(id),isCurrent:()=>true,isQuiet:()=>true,deliver:j=>delivered.push(j),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 const question=language==='en'?'Berkeley 2026–27 costs including on-campus, off-campus and living with parents.':'Costos de Berkeley 2026–27 dentro del campus, fuera del campus y con padres.';
 try{
  const original=await q.start({question,institution:'Berkeley',mode:'finance',language,studentId:'a',requestKey:'initial'});
  const update={question:language==='en'?'Compare near-campus housing versus living at home.':'Compara vivir cerca del campus con vivir en casa.',institution:'Berkeley',mode:'finance',language,studentId:'a',replaceRequestId:original.requestId,replaceRevision:1};
  for(const change of [undefined,{kind:'focus_existing',uncoveredNeed:''},{kind:'correct_scope',uncoveredNeed:language==='en'?'living with parents':'con padres'}]){
   const reused=await q.start({...update,replacementChange:change});
   assert.equal(reused.status,'research_pending');assert.equal(reused.jobId,'original');assert.equal(reused.revision,1);assert.equal(reused.replacementApplied,false);
  }
  assert.equal(posted.length,1);assert.deepEqual(removed,[]);
  await tick();await new Promise(r=>setImmediate(r));assert.equal(delivered.length,1);assert.equal(delivered[0].id,'original');
 }finally{q.close();}
});
test('a concrete corrected year can replace work, while an identical question or stale correction cannot',async()=>{
 const posted=[],removed=[];const q=backgroundResearch({requireReplacementChange:true,post:async query=>(posted.push(query),{id:'job-'+posted.length}),remove:async id=>removed.push(id),isCurrent:()=>true,schedule:()=>1,cancel:()=>{}});
 try{
  const first={question:'Berkeley costs for 2026–27',institution:'Berkeley',mode:'finance',studentId:'a',requestKey:'r'};await q.start(first);
  const change={kind:'correct_scope',uncoveredNeed:'The caller corrected the academic year to 2027–28; the existing task only covers 2026–27.'};
  const unchanged=await q.start({...first,replaceRequestId:'r',replaceRevision:1,replacementChange:change});assert.equal(unchanged.reuseReason,'same_question');assert.equal(posted.length,1);
  const corrected=await q.start({...first,question:'Berkeley costs for 2027–28',replaceRequestId:'r',replaceRevision:1,replacementChange:change});
  assert.equal(corrected.revision,2);assert.equal(posted.length,2);assert.deepEqual(removed,['job-1']);assert.equal(posted[1].replacementChange,undefined);
  const stale=await q.start({...first,replaceRequestId:'r',replaceRevision:1,replacementChange:change});assert.equal(stale.status,'research_request_changed');assert.equal(posted.length,2);
 }finally{q.close();}
});

for(const language of ['en','es'])test(`${language}: progressive polling delivers initial facts once while keeping recovery active`,async()=>{
 let tick,status='running',version=1;const delivered=[],active=[],posted=[];
 const q=backgroundResearch({progressive:true,post:async input=>(posted.push(input),{id:'job'}),read:async()=>({status,result:{text:'Checked facts',sources:[{url:'https://example.edu'}],evidenceVersion:version,researchPending:status==='running'}}),remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:j=>delivered.push(j),onState:value=>active.push(value),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 try{
  const receipt=await q.start({question:'Costs',language,requestKey:'request'});
  await tick();await tick();assert.equal(delivered.length,1);assert.equal(delivered[0].status,'running');assert.equal(active.at(-1),true);
  assert.equal((await q.start({question:'And housing?',language})).requestId,receipt.requestId);assert.equal(posted.length,1);
  status='completed';version=2;await tick();assert.equal(delivered.length,2);assert.equal(delivered[1].result.evidenceVersion,2);assert.equal(active.at(-1),false);
  await tick();assert.equal(delivered.length,2);
 }finally{q.close();}
});

test('provisional evidence is discarded when student scope changes during its read',async()=>{
 let tick,current=true;const delivered=[],removed=[];
 const q=backgroundResearch({progressive:true,post:async()=>({id:'job'}),read:async()=>{current=false;return {status:'running',result:{evidenceVersion:1,researchPending:true,text:'Private scope'}};},remove:async id=>removed.push(id),isCurrent:()=>current,isQuiet:()=>true,deliver:j=>delivered.push(j),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 await q.start({question:'Costs'});await tick();assert.equal(delivered.length,0);assert.deepEqual(removed,['job']);q.close();
});

test('legacy polling does not expose running findings to completed-only clients',async()=>{
 let tick;const delivered=[];
 const q=backgroundResearch({post:async()=>({id:'job'}),read:async()=>({status:'running',result:{evidenceVersion:1,researchPending:true,text:'Initial'}}),remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:j=>delivered.push(j),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 await q.start({question:'Costs'});await tick();assert.equal(delivered.length,0);q.close();
});

for(const failure of ['deadline','read_404','read_503_deadline','worker_crash','worker_failed'])test(`initial findings survive ${failure} with a newer terminal context`,async()=>{
 let tick,clock=0,reads=0;const delivered=[];
 const initial={text:'Verified initial fact [1].',sources:[{url:'https://example.edu'}],evidenceVersion:1,researchPending:true};
 const q=backgroundResearch({progressive:true,now:()=>clock,post:async()=>({id:'job'}),read:async()=>{
  if(++reads===1)return {status:'running',result:initial};
  if(failure.startsWith('read'))throw Object.assign(Error('unavailable'),{status:failure==='read_404'?404:503});
  return {status:'failed',...(failure==='worker_crash'?{result:initial}:{})};
 },remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:j=>delivered.push(j),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 try{
  await q.start({question:'Costs'});await tick();assert.equal(delivered.length,1);
  if(failure==='deadline')clock=120000;
  await tick();
  if(failure==='read_503_deadline')clock=120000;
  await tick();await tick();
  assert.equal(delivered.length,2);assert.equal(delivered[1].status,'failed');assert.equal(delivered[1].result.text,initial.text);
  assert.equal(delivered[1].result.evidenceVersion,2);assert.equal(delivered[1].result.researchPending,false);assert.equal(delivered[1].result.recoveryUnavailable,true);
 }finally{q.close();}
});

for(const language of ['en','es'])for(const terminal of ['completed','failed'])test(`${language}: correction after ${terminal} keeps identity and starts only the missing scenario`,async()=>{
 let tick;const posted=[],removed=[],delivered=[];
 const q=backgroundResearch({requireReplacementChange:true,post:async query=>(posted.push(query),{id:`job-${posted.length}`}),
  read:async()=>({status:terminal,result:terminal==='completed'?{text:'Residence-hall results only'}:undefined}),remove:async id=>removed.push(id),
  isCurrent:()=>true,isQuiet:()=>true,deliver:job=>delivered.push(job),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 const initial={question:language==='en'?'Berkeley residence-hall total for 2026–27':'Total en residencia universitaria de Berkeley para 2026–27',institution:'UC Berkeley',mode:'finance',language,studentId:'a',sessionId:'call',requestKey:'first'};
 try{
  const first=await q.start(initial);await tick();assert.equal(delivered.length,1);
  const correction={...initial,requestKey:'correction',question:language==='en'?'Berkeley off-campus total for 2026–27':'Total fuera del campus de Berkeley para 2026–27',replaceRequestId:first.requestId,replaceRevision:1,
   replacementChange:{kind:'correct_scope',uncoveredNeed:language==='en'?'Off-campus apartment, not the residence-hall scenario previously checked.':'Apartamento fuera del campus, no la residencia universitaria ya consultada.'}};
  const next=await q.start(correction);
  assert.equal(next.status,'research_pending');assert.equal(next.requestId,first.requestId);assert.equal(next.revision,2);
  assert.equal(posted.length,2);assert.equal(posted[1].question,correction.question);assert.equal(posted[1].replacementChange,undefined);
  assert.deepEqual(removed,[],'no cancellation claim or DELETE for already finished work');
  const stale=await q.start(correction);assert.equal(stale.status,'research_request_changed');assert.equal(stale.searchStarted,false);assert.equal(stale.activeTask.revision,2);assert.equal(stale.activeTask.status,'research_pending');assert.equal(posted.length,2);
  await tick();assert.equal(delivered.at(-1).revision,2);
  const retried=await q.start({...correction,replaceRequestId:undefined,replaceRevision:undefined});
  assert.equal(retried.status,`research_${terminal}`);assert.equal(posted.length,2,'same call identity cannot rerun completed work');
 }finally{q.close();}
});

for(const invalidation of ['cancel','scope','new_task'])test(`terminal receipt cannot replace work after ${invalidation}`,async()=>{
 let tick,current=true,posts=0;const q=backgroundResearch({requireReplacementChange:true,post:async()=>({id:`j${++posts}`}),read:async()=>({status:'completed'}),remove:async()=>{},isCurrent:input=>input.studentId==='a'?current:true,isQuiet:()=>true,deliver:()=>{},schedule:fn=>(tick=fn,1),cancel:()=>{}});
 try{
  const first=await q.start({question:'Initial campus costs',studentId:'a',sessionId:'call'});await tick();
  if(invalidation==='cancel')await q.cancel();
  if(invalidation==='scope')current=false;
  if(invalidation==='new_task')await q.start({question:'Different task',studentId:'a',sessionId:'call'});
  const changed=await q.start({question:'New scope costs',studentId:invalidation==='scope'?'b':'a',sessionId:'call',replaceRequestId:first.requestId,replaceRevision:1,replacementChange:{kind:'correct_scope',uncoveredNeed:'A materially different published scenario'}});
  assert.equal(changed.status,'research_request_changed');assert.equal(posts,invalidation==='new_task'?2:1);
 }finally{q.close();}
});

test('focusing a covered completed check returns a terminal receipt, never another pending promise',async()=>{
 let tick,posts=0;const q=backgroundResearch({requireReplacementChange:true,post:async()=>({id:`j${++posts}`}),read:async()=>({status:'completed'}),remove:async()=>{},isCurrent:()=>true,isQuiet:()=>true,deliver:()=>{},schedule:fn=>(tick=fn,1),cancel:()=>{}});
 try{
  const first=await q.start({question:'Costs including tuition and housing',institution:'Example'});await tick();
  const result=await q.start({question:'Just tuition please',institution:'Example',replaceRequestId:first.requestId,replaceRevision:1,replacementChange:{kind:'focus_existing',uncoveredNeed:''}});
  assert.equal(result.status,'research_completed');assert.equal(result.researchPending,false);assert.equal(result.replacementApplied,false);assert.equal(posts,1);
  assert.match(result.instruction,/check has ended/);assert.doesNotMatch(result.instruction,/source check is already accepted/);
 }finally{q.close();}
});
