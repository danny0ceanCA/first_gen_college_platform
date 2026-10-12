import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {createHistoryRepository} from './history.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createTopicRepository,createTopicService,createTopicNotesHandler,validateTopicRequest,validateSuggestions} from './topic-notes.mjs';

const student={id:'sofia',name:'Sofia',stage:'Community college',interest:'Art',gpa:'',color:'peach'};
const summary='Sofia is interested in art. We discussed transfer courses. She still wants to ask a counselor which courses transfer.';
const item={id:'conversation',studentId:'sofia',mode:'planning',date:'2026-10-08T12:00:00Z',summary,sources:[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-08T12:00:00Z'}]};
const suggestion={topic:'transfer',kind:'question',content:'Which courses transfer? Ask a counselor.',quote:'She still wants to ask a counselor which courses transfer.'};
const note={topic:'options',kind:'note',content:'I am interested in art.',language:'en'};
const manual=(studentId='sofia',id=randomUUID())=>({action:'create',studentId,id,note});
const response=output=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:typeof output==='string'?output:JSON.stringify(output)}]}]}));
async function setup(t){
 const f=await fixture();t.after(()=>f.pool.end());
 await f.pool.query(await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8'));
 await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student});
 await f.run('owner',{action:'save-student',student:{...student,id:'mateo',name:'Mateo'}});
 return {...f,repo:createTopicRepository(f.pool),history:createHistoryRepository(f.pool)};
}
const rejects=(promise,status,message)=>assert.rejects(promise,{status,...(message?{message}:{})});

test('topic API requires explicit scope and bounded valid fields and strips forged ownership',()=>{
 for(const input of [{action:'load'},{action:'load',studentId:''},{action:'source',studentId:null},{...manual(),id:'bad'},{...manual(),note:{...note,content:' '}},{...manual(),note:{...note,content:'x'.repeat(2001)}},{...manual(),note:{...note,topic:'mastered'}},{...manual(),note:{...note,kind:'mastered'}},{...manual(),note:{...note,language:'fr'}},{action:'delete',studentId:null,id:randomUUID(),version:0}])assert.throws(()=>validateTopicRequest(input),{status:400});
 assert.deepEqual(validateTopicRequest({action:'load',studentId:null,accountId:'other',notes:['forged']}),{action:'load',studentId:null});
 assert.deepEqual(validateTopicRequest({...manual('sofia','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),note:{...note,status:'suggested',origin:'conversation',content:'  Art  '}}),{action:'create',studentId:'sofia',id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',note:{...note,content:'Art'}});
 assert.throws(()=>validateSuggestions([{...suggestion,quote:'Invented supporting sentence'}],summary),{status:502});
 assert.throws(()=>validateSuggestions([suggestion,suggestion],summary),{status:502});
 assert.throws(()=>validateSuggestions(Array(7).fill(suggestion),summary),{status:502});
 assert.deepEqual(validateSuggestions([],summary),[]);
});

test('notes survive reload, isolate accounts/students/family, and reject stale edits',async t=>{
 const {repo}=await setup(t);const input=manual();
 let result=await repo('owner',input);assert.equal(result.notes[0].status,'saved');assert.equal(result.notes[0].origin,'user');
 assert.equal((await repo('owner',input)).notes.length,1,'retry is idempotent');
 assert.equal((await repo('owner',{action:'load',studentId:'sofia'})).notes[0].content,note.content);
 for(const [subject,studentId] of [['other','sofia'],['owner','mateo'],['owner',null]])assert.deepEqual((await repo(subject,{action:'load',studentId})).notes,[]);
 await rejects(repo('owner',manual('missing')),404);
 await rejects(repo('other',{action:'update',studentId:'sofia',id:input.id,version:1,note}),404);
 await rejects(repo('owner',{action:'delete',studentId:'mateo',id:input.id,version:1}),404);
 await rejects(repo('owner',{...input,note:{...note,content:'Different retry'}}),409);
 result=await repo('owner',{action:'update',studentId:'sofia',id:input.id,version:1,note:{...note,content:'Art and design.',topic:'applications'}});
 assert.equal(result.notes[0].version,2);assert.equal(result.notes[0].topic,'applications');
 await rejects(repo('owner',{action:'update',studentId:'sofia',id:input.id,version:1,note}),409,'note_changed');
 await rejects(repo('owner',{action:'delete',studentId:'sofia',id:input.id,version:1}),409);
 await repo('owner',manual(null));assert.equal((await repo('owner',{action:'load',studentId:null})).notes.length,1);
 await repo('owner',{action:'delete',studentId:'sofia',id:input.id,version:2});assert.equal((await repo('owner',{action:'load',studentId:'sofia'})).notes.length,0);
});

test('suggestions use stored evidence, stay unaccepted, retain sources, and never regenerate dismissed or edited notes',async t=>{
 const {pool,repo,history}=await setup(t);await history('owner',{action:'save',item});let calls=0;
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async(url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(JSON.parse(body.input).summary,summary);assert.equal(body.text.format.type,'json_schema');return response({notes:[suggestion,{topic:'options',kind:'note',content:'Interested in art.',quote:'Sofia is interested in art.'}]});
 });
 const input={action:'suggest',studentId:'sofia',summaryId:item.id,language:'en'};
 let result=await service('owner',input);assert.equal(calls,1);assert.equal(result.notes.length,2);assert.ok(result.notes.every(n=>n.status==='suggested'&&n.origin==='conversation'));
 assert.deepEqual(result.notes[0].sources,item.sources.map(s=>({...s,checkedAt:new Date(s.checkedAt).toISOString()})));assert.equal(new Date(result.notes[0].conversationAt).toISOString(),new Date(item.date).toISOString());assert.deepEqual(result.generatedSummaryIds,[item.id]);
 const kept=result.notes.find(n=>n.topic==='options'),dismissed=result.notes.find(n=>n.topic==='transfer');
 await service('owner',{action:'update',studentId:'sofia',id:kept.id,version:1,note:{...note,content:'My corrected preference.'}});
 await service('owner',{action:'delete',studentId:'sofia',id:dismissed.id,version:1});
 result=await service('owner',{...input,language:'es'});assert.equal(calls,1);assert.equal(result.notes.length,1);assert.equal(result.notes[0].content,'My corrected preference.');assert.equal(result.notes[0].status,'saved');
 await rejects(service('other',input),404);await rejects(service('owner',{...input,studentId:'mateo'}),404);await rejects(service('owner',{...input,studentId:null}),404);assert.equal(calls,1);
 await repo('owner',manual());await history('owner',{action:'delete',id:item.id});
 result=await repo('owner',{action:'load',studentId:'sofia'});assert.equal(result.notes.length,1);assert.equal(result.notes[0].origin,'user');assert.deepEqual(result.generatedSummaryIds,[]);
});

test('empty extraction gets a receipt; invalid and unavailable results remain retryable',async t=>{
 const {pool,history}=await setup(t);await history('owner',{action:'save',item});let attempt=0;
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{attempt++;if(attempt===1)return response({notes:[{...suggestion,quote:'Not in the summary'}]});if(attempt===2)return new Response('{}',{status:500});return response({notes:[]});});
 const input={action:'suggest',studentId:'sofia',summaryId:item.id,language:'es'};
 await rejects(service('owner',input),502);await rejects(service('owner',input),503);
 const result=await service('owner',input);assert.deepEqual(result.notes,[]);assert.deepEqual(result.generatedSummaryIds,[item.id]);
 await service('owner',input);assert.equal(attempt,3);
});

test('translation is cached, preserves the original, and is invalidated by an edit',async t=>{
 const {pool,repo}=await setup(t);const input=manual();await repo('owner',input);let calls=0;
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{calls++;return response('Me interesa el arte.');});
 const translate={action:'translate',studentId:'sofia',id:input.id,version:1,language:'es'};
 let result=await service('owner',translate);assert.equal(result.notes[0].content,note.content);assert.equal(result.notes[0].translations.es,'Me interesa el arte.');assert.equal(result.notes[0].version,1);
 await service('owner',translate);await service('owner',{...translate,language:'en'});assert.equal(calls,1);
 await rejects(service('other',translate),404);await rejects(service('owner',{...translate,studentId:null}),404);assert.equal(calls,1);
 result=await service('owner',{action:'update',studentId:'sofia',id:input.id,version:1,note:{...note,content:'Art.'}});assert.deepEqual(result.notes[0].translations,{});
 await rejects(service('owner',translate),409);await service('owner',{...translate,version:2});assert.equal(calls,2);
});

test('concurrent suggestions share one AI request and deleted source cannot be resurrected',async t=>{
 const {pool,history}=await setup(t);await history('owner',{action:'save',item});let release,started,calls=0;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{calls++;started();await wait;return response({notes:[suggestion]});});
 const input={action:'suggest',studentId:'sofia',summaryId:item.id,language:'en'};
 const one=service('owner',input),two=service('owner',input);await ready;release();await Promise.all([one,two]);assert.equal(calls,1);assert.equal((await service('owner',{action:'load',studentId:'sofia'})).notes.length,1);
 await history('owner',{action:'save',item:{...item,id:'delete-mid-call'}});
 const deleting=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{await history('owner',{action:'delete',id:'delete-mid-call'});return response({notes:[suggestion]});});
 await rejects(deleting('owner',{...input,summaryId:'delete-mid-call'}),404);assert.equal((await pool.query('SELECT * FROM origen_topic_note_batches')).rows.length,1);
});

test('translation cannot overwrite a newer edit while the model is responding',async t=>{
 const {pool,repo}=await setup(t);const input=manual();await repo('owner',input);
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{await repo('owner',{action:'update',studentId:'sofia',id:input.id,version:1,note:{...note,content:'Changed during request'}});return response('Versión anterior.');});
 await rejects(service('owner',{action:'translate',studentId:'sofia',id:input.id,version:1,language:'es'}),409);
 const result=await repo('owner',{action:'load',studentId:'sofia'});assert.equal(result.notes[0].content,'Changed during request');assert.deepEqual(result.notes[0].translations,{});
});

test('AI limit caps new requests but does not prevent manual notes or cached translations',async t=>{
 const {pool,repo}=await setup(t);let calls=0;const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{calls++;return response('Arte.');});
 const first=manual();await repo('owner',first);
 const cached={action:'translate',studentId:'sofia',id:first.id,version:1,language:'es'};await service('owner',cached);
 for(let i=1;i<20;i++){const input=manual();await repo('owner',input);await service('owner',{...cached,id:input.id});}
 const input=manual();await service('owner',input);await rejects(service('owner',{...cached,id:input.id}),429,'notes_ai_limit');
 await service('owner',cached);assert.equal(calls,20);assert.equal((await service('owner',{action:'load',studentId:'sofia'})).notes.length,21);
});

test('account export includes notes and deletion cascades without affecting other accounts',async t=>{
 const {pool,repo,history,run}=await setup(t);await repo('owner',manual());await repo('owner',manual(null));await repo('other',{...manual(),note:{...note,content:'OTHER PRIVATE'}});
 await history('owner',{action:'save',item});await createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>response({notes:[suggestion]}))('owner',{action:'suggest',studentId:'sofia',summaryId:item.id,language:'en'});
 const life=createLifecycleRepository(pool),data=await life('owner',{action:'export'});assert.equal(data.topicNotes.length,3);assert.equal(data.topicNoteBatches.length,1);assert.doesNotMatch(JSON.stringify(data),/OTHER PRIVATE/);
 await run('owner',{action:'delete-student',id:'sofia'});assert.equal((await repo('owner',{action:'load',studentId:null})).notes.length,1);
 assert.equal((await pool.query('SELECT * FROM origen_topic_note_batches')).rows.length,0);
 await life('owner',{action:'delete',confirmation:'DELETE'});assert.equal((await pool.query('SELECT * FROM origen_topic_notes')).rows.length,1);
 assert.equal((await repo('other',{action:'load',studentId:'sofia'})).notes[0].content,'OTHER PRIVATE');
});

async function invoke(handler,input,overrides={}){let status,body,headers;await handler(Object.assign(Readable.from([typeof input==='string'?input:JSON.stringify(input)]),{url:'/api/topic-notes',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'owner'}},overrides),{writeHead(s,h){status=s;headers=h;},end(s){body=JSON.parse(s);}},()=>assert.fail('unexpected next'));return {status,body,headers};}
test('HTTP handler authenticates, bounds bodies, and never exposes storage errors or private data',async t=>{
 const {pool}=await setup(t),handler=createTopicNotesHandler(pool,{});
 assert.equal((await invoke(handler,{action:'load',studentId:'sofia'},{origenAuthorized:false})).status,401);
 assert.equal((await invoke(handler,{}, {method:'GET'})).status,405);
 assert.equal((await invoke(handler,{}, {headers:{'content-type':'text/plain'}})).status,415);
 assert.equal((await invoke(handler,'x'.repeat(16001))).status,413);
 assert.equal((await invoke(handler,'{')).status,400);
 assert.equal((await invoke(handler,{action:'store-suggestions',studentId:'sofia'})).status,400);
 const result=await invoke(handler,manual());assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'no-store');
 const broken=createTopicNotesHandler({connect:async()=>{throw new Error('SECRET SQL details');}});
 const failure=await invoke(broken,{action:'load',studentId:null});assert.equal(failure.status,503);assert.deepEqual(failure.body,{error:'notes_unavailable'});
});

test('transaction failure rolls back and releases the client',async()=>{
 const queries=[];let released=false;
 const repo=createTopicRepository({connect:async()=>({query:async sql=>{queries.push(sql);if(sql!=='BEGIN'&&sql!=='ROLLBACK')throw new Error('database failure');return {rows:[]};},release(){released=true;}})});
 await assert.rejects(repo('owner',{action:'load',studentId:null}),/database failure/);assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});

test('binder sync catches up in bounded batches, routes mixed topics by content, and isolates scopes',async t=>{
 const {pool,history,repo}=await setup(t);
 const mixed='Sofia wants to compare art majors. FAFSA was explained as an aid application. She asked how to prepare transfer essays.';
 for(let i=0;i<4;i++)await history('owner',{action:'save',item:{...item,id:`mixed-${i}`,summary:mixed,date:`2026-10-0${i+1}T12:00:00Z`}});
 await history('owner',{action:'save',item:{...item,id:'family-only',studentId:null,summary:'FAMILY ONLY private discussion.'}});
 await history('owner',{action:'save',item:{...item,id:'sibling-only',studentId:'mateo',summary:'SIBLING ONLY private discussion.'}});
 await history('other',{action:'save',item:{...item,id:'other-only',summary:'OTHER ONLY private discussion.'}});
 let calls=0;
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);
  assert.match(body.instructions,/topics actually discussed|what was actually discussed/);
  assert.match(body.instructions,/guide mode is only a hint/);
  assert.equal(JSON.parse(body.input).summary,mixed);
  return response({notes:[
   {topic:'options',kind:'note',content:'Comparing art majors.',quote:'Sofia wants to compare art majors.'},
   {topic:'costs',kind:'explanation',content:'FAFSA was discussed as an aid application.',quote:'FAFSA was explained as an aid application.'},
   {topic:'applications',kind:'question',content:'How can I prepare transfer essays?',quote:'She asked how to prepare transfer essays.'}
  ]});
 });
 const input=validateTopicRequest({action:'sync',studentId:'sofia',language:'en',summaryId:'family-only',accountId:'other'});
 assert.deepEqual(input,{action:'sync',studentId:'sofia',language:'en'});
 let result=await service('owner',input);
 assert.equal(calls,3);assert.equal(result.pendingCount,1);assert.equal(result.notes.length,9);
 assert.ok(result.notes.every(n=>n.studentId==='sofia'&&n.status==='suggested'&&n.kind!=='decision'));
 assert.deepEqual(new Set(result.notes.map(n=>n.topic)),new Set(['options','costs','applications']));
 result=await service('owner',input);assert.equal(calls,4);assert.equal(result.pendingCount,0);assert.equal(result.notes.length,12);
 await service('owner',input);assert.equal(calls,4,'reopening uses extraction receipts without another model request');
 await repo('owner',{action:'delete',studentId:'sofia',id:result.notes[0].id,version:1});
 result=await service('owner',input);assert.equal(result.notes.length,11);assert.equal(calls,4,'removed recaps are not regenerated');
 await history('owner',{action:'clear',studentId:'sofia'});
 result=await service('owner',input);assert.equal(result.notes.length,0);assert.equal(result.pendingCount,0);assert.equal(calls,4);
 assert.equal((await history('owner',{action:'load',studentId:null})).items.length,1);
 await rejects(service('owner',{...input,studentId:'missing'}),404);assert.equal(calls,4);
});

test('concurrent binder catch-ups share extraction and a failed batch resumes without repeating saved points',async t=>{
 const {pool,history}=await setup(t);
 for(let i=0;i<2;i++)await history('owner',{action:'save',item:{...item,id:`retry-${i}`}});
 let calls=0,release,started;const waiting=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 const service=createTopicService(pool,{OPENAI_API_KEY:'fake'},async()=>{
  calls++;if(calls===1){started();await waiting;}
  if(calls===2)return new Response('{}',{status:500});
  return response({notes:[suggestion]});
 });
 const input={action:'sync',studentId:'sofia',language:'en'};
 const one=service('owner',input),two=service('owner',input);await ready;release();
 const results=await Promise.allSettled([one,two]);assert.ok(results.every(result=>result.status==='rejected'));assert.equal(calls,2);
 assert.equal((await service('owner',{action:'load',studentId:'sofia'})).notes.length,1);
 const result=await service('owner',input);assert.equal(calls,3);assert.equal(result.notes.length,2);assert.equal(result.pendingCount,0);
 await service('owner',input);assert.equal(calls,3);
});
