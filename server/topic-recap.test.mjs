import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture} from './family-fixture.mjs';
import {createTopicRepository} from './topic-notes.mjs';
import {createTopicRecapService,createTopicRecapHandler,recapEvidence,validateRecapRequest,validateRecapOutput,topicRecapInstructions} from './topic-recap.mjs';
import {createProxyRecapHandler} from './topic-recap-dev.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
const input={studentId:'alex',topic:'transfer',language:'en'};
const note=(id,content,extra={})=>({id,studentId:'alex',topic:'transfer',kind:'explanation',status:'saved',version:1,content,...extra});
const detail=(id,content,extra={})=>({id,studentId:'alex',organization:{topic:'transfer'},category:'goal',status:'proposed',reportedBy:'parent',content,...extra});
const data=()=>({notes:[note('a','Compare course requirements with a counselor before choosing classes.'),note('b','This approach helps with course planning.')],memories:[detail('c','A parent said Alex is considering UC Davis for political science.')]});
const response=body=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(body)}]}]}));
const output={paragraphs:[{text:'Alex’s parent described an interest in political science at UC Davis. The discussion connected that possibility with checking course requirements before choosing classes.',refs:['memory:c','note:a']}]};
test('recap logs distinguish background generation, source reads, cache reuse, and failures without recording private data',async()=>{
 let time=0,failed=false;const logs=[];
 const run=createTopicRecapService({load:async()=>{time+=5;return data();},clock:()=>time,log:event=>logs.push(diagnosticRecord({...event,subject:'secret-account',content:'private note'})),env:{OPENAI_API_KEY:'synthetic'},request:async()=>{time+=20;return failed?new Response('{}',{status:503}):response(output);}});
 await run('owner',input,{mode:'background'});
 assert.equal(logs[0].event,'recap.load.finished');assert.equal(logs[0].recapMode,'background');assert.equal(logs[0].recapCache,'generated');
 assert.equal(logs[0].durationMs,30);assert.equal(logs[0].sourceMs,10);assert.equal(logs[0].generationMs,20);
 await run('owner',input);assert.equal(logs[1].recapCache,'hit');assert.equal(logs[1].durationMs,5);assert.equal(logs[1].generationMs,0);
 failed=true;await assert.rejects(run('owner',{...input,language:'es'},{mode:'background'}));assert.equal(logs[2].outcome,'failed');assert.equal(logs[2].generationMs,20);
 assert.ok(!JSON.stringify(logs).includes('secret-account'));assert.ok(!JSON.stringify(logs).includes('private note'));assert.ok(!JSON.stringify(logs).includes('Alex'));
});

test('recap diagnostics identify provider, token, refusal and validation failures without exposing response content',async()=>{
 const cases=[
  ['provider_http',()=>new Response('secret provider body',{status:429}),429],
  ['provider_body',()=>new Response('secret invalid json')],
  ['output_limit',()=>new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}))],
  ['provider_refusal',()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'secret refusal text'}]}]}))],
  ['output_json',()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'secret malformed output'}]}]}))],
  ['output_validation',()=>response({paragraphs:[{text:'secret unsupported paragraph',refs:['secret foreign ref']}]})],
 ];
 for(const [reason,request,httpStatus] of cases){
  const logs=[];const run=createTopicRecapService({load:async()=>data(),env:{OPENAI_API_KEY:'synthetic'},request,log:event=>logs.push(diagnosticRecord(event))});
  await assert.rejects(run('owner',input),{status:503,message:'recap_unavailable'});
  assert.equal(logs[0].recapFailure,reason);assert.equal(logs[0].httpStatus,httpStatus);assert.doesNotMatch(JSON.stringify(logs),/secret|Alex|foreign/);
 }
 const rejected=diagnosticRecord({event:'recap.load.finished',recapFailure:'secret injected reason'});
 assert.equal(rejected.recapFailure,undefined);
});

test('a coalesced invalid recap reports the same output cause to both callers',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),logs=[];
 const run=createTopicRecapService({load:async()=>data(),env:{OPENAI_API_KEY:'synthetic'},request:async()=>{await gate;return response({paragraphs:[{text:'Invalid reference',refs:['missing']}]});},log:event=>logs.push(diagnosticRecord(event))});
 const work=Promise.allSettled([run('owner',input),run('owner',input)]);
 await new Promise(resolve=>setImmediate(resolve));release();
 assert.ok((await work).every(result=>result.status==='rejected'));
 assert.deepEqual(logs.map(event=>event.recapFailure),['output_validation','output_validation']);
});
async function invoke(handler,body,{authorized=true,authorization='Bearer synthetic',origin='http://127.0.0.1:5173'}={}){
 const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{url:'/api/topic-recap',method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1:5173',origin,authorization},origenAuthorized:authorized,origenIdentity:{sub:'owner'}});
 let status,result;const res={writeHead(code){status=code;},end(body){result=JSON.parse(body);}};
 await handler(req,res,()=>assert.fail('unexpected next'));return {status,result};
}
test('selects only current records for the exact account scope and divider; never rewrites originals',()=>{
 const source=data();source.notes.push(note('other','other student',{studentId:'other'}),note('family','family',{studentId:null}),note('costs','costs',{topic:'costs'}),note('deleted','removed',{status:'deleted'}),note('excluded','old',{excludedFromGuidance:true}));
 source.memories.push(detail('gone','deleted',{status:'deleted'}),detail('old','old',{summaryId:'suppressed'}),detail('corrected','new corrected goal',{summaryId:'suppressed',contextCurrent:true}));source.suppressedSummaryIds=['suppressed'];
 const before=structuredClone(source);const evidence=recapEvidence(input,source);
 assert.deepEqual(new Set(evidence.entries.map(e=>e.id)),new Set(['a','b','c','corrected']));assert.deepEqual(source,before);
 assert.equal(evidence.entries.find(e=>e.id==='c').evidence.reportedBy,'parent');
 assert.deepEqual(recapEvidence({...input,studentId:null},source).entries.map(e=>e.id),['family']);
 assert.deepEqual(validateRecapRequest({...input,notes:[note('forged','invented')],accountId:'someone'}),input);
});
test('recap is a connected narrative with validated source references, not the dangling excerpt; reuse and invalidation',async()=>{
 let source=data(),calls=0,time=0;
 const run=createTopicRecapService({load:async()=>source,env:{OPENAI_API_KEY:'synthetic'},now:()=>time,request:async(_url,opts)=>{
  calls++;const body=JSON.parse(opts.body);assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.match(body.instructions,/2–3 connected/);assert.match(body.instructions,/never guess/);assert.match(body.instructions,/Parent reports stay attributed/);
  assert.deepEqual(new Set(body.text.format.schema.properties.paragraphs.items.properties.refs.items.enum),new Set(['note:a','note:b','memory:c']));
  return response(output);
 }});
 const result=await run('owner',input);assert.equal(result.paragraphs.length,1);assert.ok(!result.paragraphs[0].text.includes('This approach'));assert.equal(result.sources.length,2);
 await run('owner',input);assert.equal(calls,1);
 source=structuredClone(source);source.notes[0].version++;await run('owner',input);assert.equal(calls,2,'corrections invalidate');
 await run('other',input);assert.equal(calls,3,'never reuse another account cache');
 await run('owner',{...input,language:'es'});assert.equal(calls,4,'language has a separate recap');
 time=300001;await run('owner',input);assert.equal(calls,5,'short-lived cache expires');
});
test('concurrent requests coalesce and deleting a source in flight discards the generated recap',async()=>{
 let source=data(),release,calls=0;const gate=new Promise(resolve=>release=resolve);
 const run=createTopicRecapService({load:async()=>source,env:{OPENAI_API_KEY:'synthetic'},request:async()=>{calls++;await gate;return response(output);}});
 const one=run('owner',input),two=run('owner',input);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 source.notes=[];release();await assert.rejects(one,{status:409});await assert.rejects(two,{status:409});
});
test('auth is rechecked before serving cached narrative; hallucinated references and oversized output fail closed',async()=>{
 let denied=false;
 const run=createTopicRecapService({load:async()=>{if(denied)throw Object.assign(new Error('closed'),{status:403});return data();},env:{OPENAI_API_KEY:'synthetic'},request:async()=>response(output)});
 await run('owner',input);denied=true;await assert.rejects(run('owner',input),{status:403});
 const evidence=recapEvidence(input,data());
 for(const paragraphs of [[{text:'Unsupported',refs:['note:another-student']}],[{text:'Unsupported',refs:[]}],[{text:'word '.repeat(300),refs:['note:a']}],Array(4).fill(output.paragraphs[0])])assert.throws(()=>validateRecapOutput({paragraphs},evidence),{status:503});
 assert.match(topicRecapInstructions,/Conflicting plans remain unresolved/);
});
test('empty evidence does not call a model; inputs and per-account generation cost are bounded',async()=>{
 const run=createTopicRecapService({load:async()=>({notes:[],memories:[]}),request:async()=>assert.fail('paid call')});assert.deepEqual((await run('owner',input)).paragraphs,[]);
 assert.throws(()=>validateRecapRequest({...input,topic:'other'}),{status:400});
 const evidence=recapEvidence(input,{notes:Array.from({length:500},(_,i)=>note(String(i),'Long '.repeat(400)))});assert.ok(evidence.omitted>0);assert.ok(JSON.stringify(evidence.entries).length<31000);
 let version=0,calls=0;const limited=createTopicRecapService({load:async()=>({notes:[note('a','text',{version:version++})]}),env:{OPENAI_API_KEY:'synthetic'},request:async()=>{calls++;return response({paragraphs:[]});}});
 // A changing source intentionally fails the post-generation check, yet spends
 // the budget, so repeated mutation/failure cannot trigger unbounded AI calls.
 for(let i=0;i<20;i++)await assert.rejects(limited('owner',input),{status:409});await assert.rejects(limited('owner',input),{status:429});assert.equal(calls,20);
});
test('real repository handler rejects another account/student and never saves a recap',async t=>{
 const f=await fixture();t.after(()=>f.pool.end());await f.pool.query(await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8'));
 const student={id:'alex',name:'Alex',stage:'Community college',interest:'Art',gpa:'',color:'peach'};await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student:{...student,id:'other'}});
 const repo=createTopicRepository(f.pool),id=randomUUID();await repo('owner',{action:'create',studentId:'alex',id,note:{topic:'transfer',kind:'explanation',content:'Discuss course choices with a counselor.',language:'en'}});
 let calls=0;const handler=createTopicRecapHandler(f.pool,{OPENAI_API_KEY:'synthetic'},async()=>{calls++;return response({paragraphs:[{text:'The discussion focused on reviewing course choices with a counselor.',refs:['note:'+id]}]});});
 assert.equal((await invoke(handler,input,{authorized:false,authorization:''})).status,401);
 assert.equal((await invoke(handler,{...input,studentId:'other'})).status,404);assert.equal(calls,0);
 assert.equal((await invoke(handler,input)).status,200);assert.equal(calls,1);
 assert.equal((await repo('owner',{action:'load',studentId:'alex'})).notes.length,1);
});
test('local preview uses only authorized read endpoints and rejects denied reads before any model call',async()=>{
 const calls=[];const handler=createProxyRecapHandler({DEV_API_PROXY_TARGET:'https://api.example.test',OPENAI_API_KEY:'synthetic'},async(url,opts)=>{
  calls.push(String(url));assert.equal(opts.headers.Authorization,'Bearer synthetic');assert.equal(JSON.parse(opts.body).action,'load');return new Response('{}',{status:403});
 });
 const result=await invoke(handler,input,{authorized:false});assert.equal(result.status,403);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('https://api.example.test/api/')));
 assert.equal((await invoke(handler,input,{authorized:false,origin:'https://untrusted.example'})).status,403);assert.equal(calls.length,2);
});

 test('confirmed details survive source suppression, while unconfirmed source-derived details do not',()=>{
 const evidence=recapEvidence(input,{notes:[],memories:[detail('confirmed','The corrected destination is UC Santa Cruz.',{status:'confirmed',summaryId:'old'}),detail('proposed','Old unreviewed destination.',{summaryId:'old'})],suppressedSummaryIds:['old']});
 assert.deepEqual(evidence.entries.map(e=>e.id),['confirmed']);
 });
 test('a real parent-authored note keeps attribution after source text is rewritten',async t=>{
 const f=await fixture();t.after(()=>f.pool.end());await f.pool.query(await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8'));
 await f.run('parent',{action:'save-student',student:{id:'alex',name:'Alex',stage:'Community college',interest:'Art',gpa:'',color:'peach'}});
 await f.pool.query("UPDATE origen_accounts SET role='parent' WHERE auth0_subject=$1",['parent']);
 const repo=createTopicRepository(f.pool);await repo('parent',{action:'create',studentId:'alex',id:randomUUID(),note:{topic:'transfer',kind:'note',content:'I would like Alex to consider UC Davis.',language:'en'}});
 await f.pool.query("ALTER TABLE origen_topic_notes ADD COLUMN IF NOT EXISTS context_current boolean NOT NULL DEFAULT false");
 await f.pool.query("UPDATE origen_topic_notes SET source_quote='The earlier parent report.',context_current=true WHERE content=$1",['I would like Alex to consider UC Davis.']);
 const data=await repo('parent',{action:'load',studentId:'alex'});
 assert.equal(data.notes[0].contextCurrent,true,'Expose the server-owned correction marker for recap suppression checks');
 assert.equal(recapEvidence(input,data).entries[0].evidence.reportedBy,'parent');
 });
 test('hung source rereads time out and release generation capacity',async()=>{
 let hung=true,calls=0;
 const run=createTopicRecapService({sourceTimeoutMs:15,env:{OPENAI_API_KEY:'synthetic'},load:async()=>{if(++calls>1&&hung)return new Promise(()=>{});return data();},request:async()=>response(output)});
 await assert.rejects(run('owner',input),{name:'TimeoutError'});
 hung=false;assert.equal((await run('owner',input)).paragraphs.length,1);
 });

 test('a newer suppression read excludes stale notes before any model request, preserving explicit corrections',async()=>{
  const source={notes:[note('private','Withdrawn conversation detail.',{summaryId:'forgotten'}),note('edited','My corrected current plan.',{summaryId:'forgotten',contextCurrent:true})],memories:[],suppressedSummaryIds:['forgotten']};
  const run=createTopicRecapService({load:async()=>source,env:{OPENAI_API_KEY:'synthetic'},request:async(_url,opts)=>{
   const entries=JSON.parse(JSON.parse(opts.body).input).entries;
   assert.deepEqual(entries.map(e=>e.id),['edited'],'Suppressed note text must never reach the provider');
   return response({paragraphs:[{text:'My corrected current plan.',refs:['note:edited']}]});
  }});
  assert.equal((await run('owner',input)).sources.length,1);
 });
 test('reviewed goals and corrected details are not crowded out by recent unreviewed extraction under the input limit',()=>{
  const source={notes:Array.from({length:60},(_,i)=>note('n'+i,'Course discussion. '.repeat(100))),memories:[
   detail('confirmed','Alex confirmed a local college is required.',{status:'confirmed',updatedAt:'2025-01-01'}),
   detail('corrected','Alex corrected the intended major.',{contextCurrent:true,updatedAt:'2025-01-02'}),
   ...Array.from({length:12},(_,i)=>detail('new'+i,'Unreviewed idea '+i,{updatedAt:'2026-11-02'}))
  ]};
  const evidence=recapEvidence(input,source),ids=evidence.entries.map(e=>e.id);
  assert.ok(evidence.omitted>0);
  assert.ok(ids.includes('confirmed'),'Keep the account-confirmed constraint');
  assert.ok(ids.includes('corrected'),'Keep the explicit correction');
 });
