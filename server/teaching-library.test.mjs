import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {validateTeachingRequest,createTeachingLibraryHandler,loadTeachingReferences,teachingReferenceInstructions,prepareTeachingAccess} from './teaching-library.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAccount,runAsAnalytics} from './account-isolation.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {createFinanceResearchHandler} from './finance-research.mjs';
import {createAdmissionsResearchHandler} from './admissions-research.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
const doc=()=>({title:'Understanding a college offer',topic:'finance',language:'en',explanation:'Explain the idea before the term.',reviewBy:'2099-12-31'});
test('teaching input accepts conversational drafts, strips unknown fields and rejects unsafe sources and invalid dates',()=>{
 const input={action:'save',id:randomUUID(),revision:0,content:{...doc(),studentSecret:'not persisted'}};
 assert.equal(validateTeachingRequest(input).content.studentSecret,undefined);
 for(const change of [{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:password@example.org'},{reviewBy:'2026-02-30'},{explanation:'x'.repeat(6001)},{deliveryStyle:'x'.repeat(1501)},{deliveryStyle:{}},{deliveryStyle:'bad\0style'},{conversationApproach:'x'.repeat(1501)},{conversationApproach:{}},{conversationApproach:'bad\0approach'},{language:'other'},{title:''}])assert.throws(()=>validateTeachingRequest({...input,content:{...doc(),...change}}));
 assert.equal(validateTeachingRequest(input).content.deliveryStyle,'');
 assert.equal(validateTeachingRequest(input).content.conversationApproach,'');
 assert.equal(validateTeachingRequest({...input,content:{...doc(),conversationApproach:'  Acknowledge before asking.  '}}).content.conversationApproach,'Acknowledge before asking.');
 assert.equal(validateTeachingRequest({...input,content:{...doc(),deliveryStyle:'  Warm, patient, one idea at a time.  '}}).content.deliveryStyle,'Warm, patient, one idea at a time.');
 assert.throws(()=>validateTeachingRequest({action:'publish',id:input.id,revision:1}),/teaching_review_required/);
 assert.equal(validateTeachingRequest({action:'publish',id:input.id,revision:1,reviewed:true}).action,'publish');
});

test('activity request accepts only an optional teaching ID, never model or query filters',()=>{
 assert.deepEqual(validateTeachingRequest({action:'activity',query:'private',model:'forged'}),{action:'activity'});
 assert.throws(()=>validateTeachingRequest({action:'activity',id:'not-a-uuid'}));
});

test('activity records exact selected revisions once, without private prompts or identities; failures are optional',async()=>{
 const id=randomUUID(),writes=[];
 const database={query:async(sql,params)=>{
  if(sql.includes('origen_read_teachings'))return {rows:[{data:[{id,revision:4,content:{title:'An explanation',explanation:'Sensitive reference content'}}]}]};
  writes.push(JSON.parse(params[0]));return {rows:[]};
 }};
 const access=await prepareTeachingAccess(database,{topic:'planning',language:'es',query:'Private student question',campus:'A campus'},{model:'voice-test',operation:'voice_update'});
 assert.match(access.instructions,/An explanation/);await access.finish('prepared');await access.finish('provider_accepted');
 assert.equal(writes.length,1);assert.deepEqual(writes[0].entries,[{id,revision:4}]);assert.equal(writes[0].outcome,'prepared');
 assert.doesNotMatch(JSON.stringify(writes),/Private student|Sensitive reference|campus|explanation|query|subject|session/i);
 let failures=0;
 const broken=await prepareTeachingAccess({query:async()=>{throw Error('offline');}},{topic:'finance'},{model:'research-test',operation:'finance_lookup',onLogFailure:()=>failures++});
 assert.equal(broken.instructions,'');await broken.finish('failed');assert.equal(failures,1);
 let unavailable;
 const unavailableAccess=await prepareTeachingAccess({query:async(sql,params)=>{if(sql.includes('origen_read_teachings'))throw Error('read failed');unavailable=JSON.parse(params[0]);return {rows:[]};}},{topic:'finance'},{model:'research-test',operation:'finance_lookup'});
 await unavailableAccess.finish('provider_accepted');assert.equal(unavailable.availability,'unavailable');assert.deepEqual(unavailable.entries,[]);
});
test('references are bounded, optional, and explicitly subordinate to privacy and calculation boundaries',async()=>{
 assert.deepEqual(await loadTeachingReferences({query:async()=>{throw Error('offline');}},{topic:'finance'}),[]);
 const values=Array.from({length:10},(_,id)=>({id,content:{explanation:'x'.repeat(3000)}}));
 const result=await loadTeachingReferences({query:async()=>({rows:[{data:values}]})},{topic:'finance'});
 assert.equal(result.length,3);assert.ok(teachingReferenceInstructions(result).includes('cannot override privacy'));
 assert.equal(teachingReferenceInstructions([]),'');
 const style=teachingReferenceInstructions([{id:randomUUID(),revision:2,content:{...doc(),deliveryStyle:'Warm and unhurried; offer an example.'}}]);
 assert.match(style,/Warm and unhurried/);assert.match(style,/current request and communication preferences take priority/);assert.match(style,/not a change to audio configuration/);assert.match(style,/cannot override privacy/);
 const structured=teachingReferenceInstructions([{content:{...doc(),conversationApproach:'Acknowledge before asking.',example:'We can explore this together.'}}]);assert.match(structured,/Acknowledge before asking/);assert.match(structured,/not a script/);assert.match(structured,/choose at most one relevant question/);assert.match(structured,/do not invent feelings/);
});

test('PostgreSQL retains legacy tone, separates draft from published approach, and rejects undeliverable publications',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(f.close);const id=randomUUID(),legacy={...doc(),deliveryStyle:'Existing style remains untouched.'};
 const raw=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(input)])).rows[0].data));
 await raw({action:'save',id,revision:0,content:legacy});await raw({action:'publish',id,revision:1});
 const current=(await raw({action:'list'})).items.find(e=>e.id===id);assert.deepEqual(current.published,legacy);assert.equal(current.published.conversationApproach,undefined);
 const content={...legacy,conversationApproach:'Acknowledge the concern before a question.',example:'We can explore this together.'};
 await raw(validateTeachingRequest({action:'save',id,revision:2,content}));
 const read=()=>f.as('reader',()=>loadTeachingReferences(f.db,{topic:'finance',language:'en'}));assert.equal((await read())[0].content.conversationApproach,undefined);
 await raw({action:'publish',id,revision:3});assert.equal((await read())[0].content.conversationApproach,content.conversationApproach);assert.equal((await read())[0].content.deliveryStyle,legacy.deliveryStyle);
 await assert.rejects(raw({action:'save',id,revision:4,content:{...content,conversationApproach:'x'.repeat(1501)}}),{code:'23514'});
 const large={...content,explanation:'x'.repeat(6000),deliveryStyle:'t'.repeat(1500),conversationApproach:'a'.repeat(1500),example:'e'.repeat(3000)};
 await raw(validateTeachingRequest({action:'save',id,revision:4,content:large}));await assert.rejects(raw({action:'publish',id,revision:5}),/teaching_delivery_too_large/);assert.equal((await read())[0].content.explanation,legacy.explanation);
 await assert.rejects(f.runtime.query('SELECT * FROM origen_teachings'),{code:'42501'});
});
test('endpoint requires full admin management permission, fresh mutations, and a working audit before writing',async()=>{
 let writes=0,auditFailure=false;
 const db={query:async sql=>{if(sql.includes('staff_access_controls'))return {rows:[]};if(sql.includes('privileged_access_audit')){if(auditFailure)throw Error('audit offline');return {rows:[]};}writes++;return {rows:[{data:{items:[]}}]};}};
 const handler=createTeachingLibraryHandler(db,{});
 const call=async(identity,input={action:'list'})=>{
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:'/api/teaching-library',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:!!identity,origenIdentity:identity});
  let status,body;await runAsAccount({sub:identity?.sub||'anonymous'},()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('unexpected next')));return {status,body};
 };
 assert.equal((await call(null)).status,401);
 assert.equal((await call(null,{action:'activity'})).status,401);
 assert.equal((await call({sub:'coordinator',permissions:[]})).status,403);
 assert.equal((await call({sub:'coordinator',permissions:[]},{action:'activity'})).status,403);
 assert.equal((await call({sub:'reporter',permissions:['read:activity']})).status,403);
 assert.equal((await call({sub:'legacy-reviewer',permissions:['manage:institutions']})).status,403);
 const admin={sub:'admin',permissions:['read:activity','manage:institutions'],[AUTH_TIME_CLAIM]:Math.floor(Date.now()/1000)};
 assert.equal((await call(admin)).status,200);assert.equal(writes,1);
 auditFailure=true;assert.equal((await call(admin)).status,503);assert.equal(writes,1);
 auditFailure=false;assert.equal((await call({...admin,[AUTH_TIME_CLAIM]:1},{action:'save',id:randomUUID(),revision:0,content:doc()})).status,403);assert.equal(writes,1);
});

test('PostgreSQL activity: exact revisions, no matches, failure, permissions, filtering and retention', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const command=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(validateTeachingRequest(input))])).rows[0].data));
  const activity=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_activity($1::jsonb) AS data',[JSON.stringify(input||{})])).rows[0].data));
  const id=randomUUID();await command({action:'save',id,revision:0,content:doc()});await command({action:'publish',id,revision:1,reviewed:true});
  const scope={topic:'finance',language:'en',query:'private synthetic student question'};
  const first=await f.as('reader',()=>prepareTeachingAccess(f.db,scope,{model:'gpt-test',operation:'finance_lookup'}));
  // A concurrent publication change must not rewrite the earlier request's evidence.
  await command({action:'save',id,revision:2,content:{...doc(),title:'Updated title'}});
  await command({action:'unpublish',id,revision:3});
  await f.as('reader',()=>first.finish('provider_accepted','gpt-test-resolved'));
  await f.as('reader',()=>first.finish('provider_accepted'));
  const noMatch=await f.as('reader',()=>prepareTeachingAccess(f.db,scope,{model:'voice-test',operation:'voice_update'}));
  await f.as('reader',()=>noMatch.finish('prepared'));
  const failed=await f.as('reader',()=>prepareTeachingAccess(f.db,scope,{model:'voice-test',operation:'voice_start'}));
  await f.as('reader',()=>failed.finish('failed'));
  let data=await activity();assert.equal(data.summary.lookups,3);assert.equal(data.summary.matched,1);assert.equal(data.summary.accepted,1);assert.equal(data.summary.failed,1);assert.equal(data.allTime.lookups,3);
  data=await activity({id});assert.equal(data.events.length,1);assert.equal(data.events[0].entries[0].revision,2);assert.equal(data.events[0].entries[0].title,doc().title);assert.equal(data.events[0].resolved_model,'gpt-test-resolved');assert.equal(data.allTime.lookups,1);assert.ok(data.allTime.since);
  // A duplicate request receipt cannot increment either global or teaching totals.
  await f.as('reader',()=>f.db.query('SELECT origen_record_teaching_access($1::jsonb)',[JSON.stringify({id:data.events[0].id,topic:'finance',language:'en',operation:'finance_lookup',model:'gpt-test',availability:'available',outcome:'provider_accepted',entries:[{id,revision:2}]})]));
  assert.equal((await activity()).allTime.lookups,3);assert.equal((await activity({id})).allTime.lookups,1);
  assert.doesNotMatch(JSON.stringify(data),/private synthetic|student question|reader|auth0|explanation/);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT * FROM origen_teaching_access')),/permission denied/);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT * FROM origen_teaching_access_totals')),/permission denied/);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT origen_teaching_activity($1::jsonb)',['{}'])),/teaching_access_denied/);
  await assert.rejects(f.db.query('SELECT origen_record_teaching_access($1::jsonb)',['{}']),/teaching_access_denied/);
  await f.owner.query("UPDATE origen_teaching_access SET created_at=now()-interval '91 days'");
  const retained=await f.as('reader',()=>prepareTeachingAccess(f.db,scope,{model:'voice-test',operation:'voice_start'}));await f.as('reader',()=>retained.finish('provider_accepted'));
  assert.equal(Number((await f.owner.query('SELECT count(*) AS n FROM origen_teaching_access')).rows[0].n),1);
  assert.equal((await activity()).summary.lookups,1);assert.equal((await activity()).allTime.lookups,4);assert.equal((await activity({id})).allTime.lookups,1);
  const requests=await f.as('reader',()=>Promise.all(Array.from({length:10},()=>prepareTeachingAccess(f.db,scope,{model:'voice-test',operation:'voice_start'}))));
  await f.as('reader',()=>Promise.all(requests.map(request=>request.finish('provider_accepted'))));
  assert.equal((await activity()).allTime.lookups,14);
 }finally{await f.close();}
});

test('PostgreSQL: real request handlers record voice start/update and research outcomes without private text', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const id=randomUUID();const command=input=>f.as('reader',()=>runAsAnalytics(()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify(validateTeachingRequest(input))])));
  await command({action:'save',id,revision:0,content:{...doc(),topic:'general',deliveryStyle:'Warm, patient delivery.'}});await command({action:'publish',id,revision:1,reviewed:true});
  const invoke=async(handler,url,input)=>{
   const req=Object.assign(Readable.from([JSON.stringify(input)]),{url,method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status;
   await f.as('reader',()=>handler(req,{writeHead:value=>status=value,end:()=>{}},()=>assert.fail('wrong route')));return status;
  };
  let voiceCalls=0;
  const voice=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:'voice-test'},async(_url,options)=>{voiceCalls++;const config=JSON.parse(options.body.get('session'));assert.match(config.instructions,/Understanding a college offer/);assert.match(config.instructions,/Warm, patient delivery/);assert.equal(config.audio.output.speed,1);return new Response('v=0');},()=>{},f.db);
  const voiceInput={sdp:'v=0',mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true};
  assert.equal(await invoke(voice,'/api/profile-voice',voiceInput),200);
  assert.equal(await invoke(voice,'/api/profile-voice',{...voiceInput,action:'update-guide'}),200);assert.equal(voiceCalls,1);
  const response={model:'research-resolved',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified explanation.',annotations:[{type:'url_citation',url:'https://studentaid.gov/help',title:'Official source',start_index:0,end_index:8}]}]}]};
  const provider=async(_url,options)=>{const instructions=JSON.parse(options.body).instructions;assert.match(instructions,/Understanding a college offer/);assert.match(instructions,/Warm, patient delivery/);return new Response(JSON.stringify(response));};
  assert.equal(await invoke(createFinanceResearchHandler({OPENAI_API_KEY:'synthetic'},provider,()=>{},f.db),'/api/finance-research',{question:'Explain aid',institution:'',language:'en'}),200);
  assert.equal(await invoke(createAdmissionsResearchHandler({OPENAI_API_KEY:'synthetic'},provider,()=>{},f.db),'/api/admissions-research',{question:'Transfer planning',institution:'',language:'en',purpose:'planning'}),200);
  assert.equal(await invoke(createFinanceResearchHandler({OPENAI_API_KEY:'synthetic'},async()=>new Response('{}',{status:429}),()=>{},f.db),'/api/finance-research',{question:'Private Spanish question',institution:'',language:'es'}),502);
  const data=(await f.as('reader',()=>runAsAnalytics(()=>f.db.query('SELECT origen_teaching_activity($1::jsonb) AS data',['{}'])))).rows[0].data;
  assert.equal(data.summary.lookups,5);assert.equal(data.summary.accepted,3);assert.equal(data.summary.prepared,1);assert.equal(data.summary.failed,1);
  assert.deepEqual(new Set(data.events.map(row=>row.operation)),new Set(['voice_start','voice_update','finance_lookup','admissions_lookup']));
  assert.equal(data.events.find(row=>row.operation==='admissions_lookup').resolved_model,'research-resolved');
  assert.equal(data.events.find(row=>row.language==='es').entries.length,0);assert.doesNotMatch(JSON.stringify(data),/Private Spanish|Transfer planning|reader/);
 }finally{await f.close();}
});
test('PostgreSQL delivery style: legacy entries, draft isolation, publishing, Spanish and database validation', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const command=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(validateTeachingRequest(input))])).rows[0].data));
  const read=language=>f.as('reader',()=>loadTeachingReferences(f.db,{topic:'finance',language}));
  const id=randomUUID();await command({action:'save',id,revision:0,content:doc()});await command({action:'publish',id,revision:1,reviewed:true});
  assert.equal((await read('en'))[0].content.deliveryStyle,'');
  await command({action:'save',id,revision:2,content:{...doc(),deliveryStyle:'Warm and patient; pause after one idea.'}});
  assert.equal((await read('en'))[0].content.deliveryStyle,'');
  await command({action:'publish',id,revision:3,reviewed:true});
  assert.equal((await read('en'))[0].content.deliveryStyle,'Warm and patient; pause after one idea.');
  assert.equal((await f.owner.query('SELECT content FROM origen_teaching_revisions WHERE id=$1 AND revision=4',[id])).rows[0].content.deliveryStyle,'Warm and patient; pause after one idea.');
  const spanish=randomUUID();await command({action:'save',id:spanish,revision:0,content:{...doc(),language:'es',deliveryStyle:'Con calidez y calma. Una idea a la vez.'}});await command({action:'publish',id:spanish,revision:1,reviewed:true});
  assert.equal((await read('es'))[0].content.deliveryStyle,'Con calidez y calma. Una idea a la vez.');
  for(const deliveryStyle of [{tone:'warm'},'x'.repeat(1501)])await assert.rejects(f.as('reader',()=>runAsAnalytics(()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify({action:'save',id:randomUUID(),revision:0,content:{...doc(),deliveryStyle}})]))),/delivery_style/);
  await command({action:'unpublish',id,revision:4});assert.deepEqual(await read('en'),[]);
 }finally{await f.close();}
});

test('PostgreSQL migration: private drafts, version conflicts, publication scopes, expiry and revocation', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const command=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(validateTeachingRequest(input))])).rows[0].data));
  const read=(scope={})=>f.as('reader',()=>loadTeachingReferences(f.db,{topic:'finance',language:'en',...scope}));
  const id=randomUUID();let input={action:'save',id,revision:0,content:doc()};let item=(await command(input)).item;
  assert.equal(item.revision,1);assert.equal((await command(input)).item.revision,1);assert.deepEqual(await read(),[]);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT * FROM origen_teachings')),/permission denied/);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify({action:'list'})])),/teaching_access_denied/);
  item=(await command({action:'publish',id,revision:1,reviewed:true})).item;
  assert.equal((await read())[0].content.explanation,doc().explanation);
  item=(await command({action:'save',id,revision:item.revision,content:{...doc(),explanation:'Unpublished change'}})).item;
  assert.equal((await read())[0].content.explanation,doc().explanation);
  await assert.rejects(command({action:'save',id,revision:1,content:{...doc(),explanation:'Stale edit'}}),/teaching_changed/);
  assert.deepEqual(await read({language:'es'}),[]);assert.deepEqual(await read({topic:'planning'}),[]);
  item=(await command({action:'archive',id,revision:item.revision})).item;assert.deepEqual(await read(),[]);
  item=(await command({action:'restore',id,revision:item.revision})).item;assert.equal(item.published,null);
  item=(await command({action:'save',id,revision:item.revision,content:{...doc(),campus:'UC Davis',academicYear:'2026-27',sourceUrl:'https://financialaid.ucdavis.edu/',keywords:'housing, summer'}})).item;
  item=(await command({action:'publish',id,revision:item.revision,reviewed:true})).item;
  assert.deepEqual(await read(),[]);assert.deepEqual(await read({campus:'UC Davis',academicYear:'2026-27',query:'other question'}),[]);
  assert.equal((await read({campus:'uc davis',academicYear:'2026-27',query:'housing options'})).length,1);
  assert.deepEqual(await read({campus:'UC Davis',academicYear:'2027-28',query:'housing'}),[]);
  await f.owner.query("UPDATE origen_teachings SET published=jsonb_set(published,'{reviewBy}','\"2000-01-01\"') WHERE id=$1",[id]);assert.deepEqual(await read({campus:'UC Davis',academicYear:'2026-27',query:'housing'}),[]);
  assert.ok((await command({action:'history',id})).history.length>=6);
 }finally{await f.close();}
});


test('PIQ teaching reaches admissions voice start and handoff, while research keeps keyword and scope restrictions', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const command=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(validateTeachingRequest(input))])).rows[0].data));
  const id=randomUUID(),content={...doc(),title:'Student background - Essays',topic:'admissions',keywords:"PIQ's, essays, writing about myself",explanation:'Your experiences matter. You do not need a dramatic story or have to share anything painful.',deliveryStyle:'Be warm, patient, and encouraging. Ask one gentle question at a time.',conversationApproach:'Acknowledge the concern before a question.',example:'We can explore this together.'};
  await command({action:'save',id,revision:0,content});await command({action:'publish',id,revision:1,reviewed:true});
  const read=scope=>f.as('reader',()=>loadTeachingReferences(f.db,{topic:'admissions',language:'en',...scope}));
  assert.equal((await read({retrieval:'guide'}))[0].id,id);
  for(const query of ['Help me with PIQs',"Help with PIQ’s",'Let us discuss college ESSAYS'])assert.equal((await read({query}))[0].id,id);
  for(const scope of [{query:'Housing costs'},{topic:'planning',retrieval:'guide'},{language:'es',retrieval:'guide'}])assert.deepEqual(await read(scope),[]);
  const inputs=[],responses=[];
  const voice=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic'},async(_url,options)=>{inputs.push(JSON.parse(options.body.get('session')));return new Response('v=0');},()=>{},f.db);
  const invoke=async extra=>{
   const req=Object.assign(Readable.from([JSON.stringify({sdp:'v=0',mode:'admissions',studentId:'alex',role:'parent',language:'en',routeConversations:true,targetConfirmed:true,...extra})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,body;
   await f.as('reader',()=>voice(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('wrong route')));assert.equal(status,200);responses.push(body);return body;
  };
  await invoke({});assert.match(inputs[0].instructions,/Your experiences matter/);assert.match(inputs[0].instructions,/Be warm, patient/);assert.match(inputs[0].instructions,/Acknowledge the concern before a question/);assert.match(inputs[0].instructions,/We can explore this together/);
  await invoke({mode:'planning'});assert.doesNotMatch(inputs[1].instructions,/Your experiences matter/);
  const handoff=await invoke({action:'update-guide'});assert.equal(inputs.length,2,'handoff prepares an update without opening another provider call');assert.match(handoff.session.instructions,/Your experiences matter/);assert.match(handoff.session.instructions,/one gentle question/);assert.match(handoff.session.instructions,/Acknowledge the concern before a question/);
  const unresolved=await invoke({action:'update-guide',role:'student',targetConfirmed:false,studentId:undefined});assert.doesNotMatch(unresolved.session.instructions,/Your experiences matter/);
  const generalIds=[];
  for(let i=0;i<7;i++){const extra=randomUUID();generalIds.push(extra);await command({action:'save',id:extra,revision:0,content:{...doc(),topic:'general',title:'General teaching '+i}});await command({action:'publish',id:extra,revision:1,reviewed:true});}
  const bounded=await read({retrieval:'guide'});assert.equal(bounded.length,6);assert.equal(bounded[0].id,id,'guide-specific PIQ teaching is not crowded out by newer general entries');
  for(const extra of generalIds)await command({action:'archive',id:extra,revision:2});
  await f.owner.query("UPDATE origen_teachings SET published=jsonb_set(published,'{reviewBy}','\"2000-01-01\"') WHERE id=$1",[id]);assert.deepEqual(await read({retrieval:'guide'}),[]);
 }finally{await f.close();}
});
