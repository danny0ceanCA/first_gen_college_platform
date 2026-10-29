import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createAdminVoiceHandler,validateVoiceStart} from './admin-voice.mjs';
import {createCostLedger,tokenCost} from './admin-voice-cost.mjs';
import {adminVoiceSession,draftInstructions} from './admin-voice-prompts.mjs';
import {runAsAccount,runAsAnalytics} from './account-isolation.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';

const config=()=>({action:'start',id:randomUUID(),mode:'test',model:'gpt-realtime-2.1',language:'en',topic:'finance',minutes:2,scenario:'How does a college understand my situation?',campus:'',academicYear:'',sdp:'v=0\r\n'});
const identity=(sub='admin')=>({sub,permissions:['read:activity','manage:institutions'],[AUTH_TIME_CLAIM]:Math.floor(Date.now()/1000)});
const usage={input_tokens:150,output_tokens:50,input_token_details:{text_tokens:100,audio_tokens:50,cached_tokens:30,cached_tokens_details:{text_tokens:20,audio_tokens:10}},output_token_details:{text_tokens:20,audio_tokens:30}};
test('cost ledger separates voice/backend/transcription and deduplicates cumulative and response events',()=>{
 const live=createCostLedger('gpt-live-1');
 live.ingest({type:'session.usage.updated',usage:{seconds:20}});live.ingest({type:'session.usage.updated',usage:{seconds:60}});live.ingest({type:'session.usage.updated',usage:{seconds:30}});
 const event={type:'response.event',event:{type:'response.completed',response:{id:'backend',model:'gpt-6-luna',usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:500}}}}};
 live.ingest(event);live.ingest(event);assert.equal(live.snapshot().totals.voice,.05);assert.ok(Math.abs(live.snapshot().totals.backend-.000105)<1e-10);assert.equal(live.snapshot(true).complete,false);
 live.ingest({type:'session.closed',usage:{seconds:60}});assert.equal(live.snapshot(true).complete,true);
 const rtc=createCostLedger('gpt-realtime-2.1');rtc.ingest({type:'response.created',response:{id:'r'}});assert.equal(rtc.snapshot(true).complete,false);
 const done={type:'response.done',response:{id:'r',status:'cancelled',usage}};rtc.ingest(done);rtc.ingest(done);
 assert.equal(rtc.snapshot(true).totals.voice,(80*4+40*32+30*.4+20*24+30*64)/1e6);
 rtc.ingest({type:'input_audio_buffer.committed',item_id:'u'});assert.equal(rtc.snapshot(true).complete,false);
 const trans={type:'conversation.item.input_audio_transcription.completed',item_id:'u',usage:{input_tokens:200,output_tokens:20}};rtc.ingest(trans);rtc.ingest(trans);assert.equal(rtc.snapshot(true).transcriptions,1);assert.equal(rtc.snapshot(true).complete,true);
 assert.equal(tokenCost('unknown',usage),null);assert.equal(tokenCost('gpt-realtime-2.1',{input_tokens:100,output_tokens:20}),null);
 const minimum=createCostLedger('gpt-live-1');assert.equal(minimum.snapshot().total,.0125);assert.equal(minimum.snapshot(false,false).total,0);
});
test('test session allowlist, teaching interview, English/Spanish and existing philosophy',()=>{
 assert.equal(validateVoiceStart(config()).verifyTeachings,false);assert.equal(validateVoiceStart({...config(),verifyTeachings:true}).verifyTeachings,true);
 assert.throws(()=>validateVoiceStart({...config(),model:'user-controlled-model'}));assert.throws(()=>validateVoiceStart({...config(),minutes:60}));
 assert.throws(()=>validateVoiceStart({...config(),mode:'teach',model:'gpt-live-1'}));
 for(const language of ['en','es']){
  const normal=adminVoiceSession({...config(),language},[{id:'id',revision:1,content:{explanation:'Concept before term',deliveryStyle:'Warm, unhurried'}}]);
  assert.equal(normal.model,'gpt-realtime-2.1');assert.match(normal.instructions,/Warm, unhurried/);assert.match(normal.instructions,/financial-aid/);
  const interview=adminVoiceSession({...config(),language,mode:'teach'},[]);assert.equal(interview.tools.length,0);assert.match(interview.instructions,/educator/);assert.match(interview.instructions,/nothing is published automatically/);
 }
 const live=adminVoiceSession({...config(),model:'gpt-live-1'},[{content:{topic:'admissions',title:'Essay support',deliveryStyle:'Warm and unhurried'}}]);assert.equal(live.delegation.responses.model,'gpt-6-luna');assert.match(live.instructions,/<\|SpawnThinking\|>/);assert.equal(live.store,false);assert.match(live.instructions,/Warm and unhurried/);assert.match(live.instructions,/Apply delivery preferences silently/);
 assert.doesNotMatch(live.instructions,/at least eight consecutive words/);assert.doesNotMatch(live.delegation.responses.instructions,/at least eight consecutive words/);
 const complete=adminVoiceSession({...config(),model:'gpt-live-1',verifyTeachings:true},[{content:{topic:'admissions',title:'Support',deliveryStyle:'Warm. '.repeat(110)+'ACKNOWLEDGE THE CONCERN.',conversationApproach:'Validate without pity.',example:'Let us explore that together.'}}]);assert.match(complete.instructions,/ACKNOWLEDGE THE CONCERN/);assert.match(complete.instructions,/Validate without pity/);assert.match(complete.instructions,/Let us explore/);assert.match(complete.instructions,/at least eight consecutive words/);
 assert.match(draftInstructions,/Assistant questions are context, not evidence/);
});
function fixture({providerOverride,dbOverride}={}){
 const saved=new Map(),queries=[],provider=[],sockets=[];let actor='';
 const db={query:async(sql,params)=>{queries.push(sql);if(dbOverride){const result=await dbOverride(sql,params);if(result)return result;}if(sql.includes('staff_access_controls'))return {rows:[]};if(sql.includes('privileged_access_audit'))return {rows:[]};if(sql.includes('origen_read_teachings'))return {rows:[{data:[{id:randomUUID(),revision:3,content:{topic:JSON.parse(params[0]).topic,title:'Test teaching',explanation:'Concept first.',deliveryStyle:'Warm and patient.'}}]}]};
 const q=JSON.parse(params[0]);let data;
 if(q.action==='list')data=[...saved.values()];if(q.action==='get')data=saved.get(q.id);if(q.action==='create'){if(saved.has(q.id))throw Object.assign(Error(),{code:'23505'});saved.set(q.id,q.data);data=q.data;}if(q.action==='update'){saved.set(q.id,q.data);data=q.data;}return {rows:[{data}]};}};
 class Socket extends EventEmitter{constructor(url){super();this.url=url;this.readyState=0;this.sent=[];sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}send(text){const e=JSON.parse(text);this.sent.push(e);if(e.type==='session.close')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.closed',usage:{seconds:40}}))));}close(){this.readyState=3;this.emit('close');}event(e){this.emit('message',Buffer.from(JSON.stringify(e)));}}
 const request=async(url,options)=>{provider.push({url,options});if(providerOverride){const result=await providerOverride(url,options);if(result)return result;}if(url.endsWith('/hangup'))return new Response('',{status:200});if(url.endsWith('/live/sessions'))return Response.json({session:{id:'live_test'},transport:{sdp:'v=0\r\n'}});if(url.endsWith('/responses'))return Response.json({id:'draft',model:'gpt-6-luna',usage:{input_tokens:500,output_tokens:500},output:[{content:[{type:'output_text',text:JSON.stringify({title:'How colleges understand you',explanation:'Start with the student’s circumstances.',deliveryStyle:'Warm, slow, one question at a time.',keywords:'college',example:'',followUp:'What feels unclear?',referral:'Ask financial aid for individual amounts.'})}]}]});return new Response('v=0\r\n',{headers:{Location:'/v1/realtime/calls/rtc_test'}});};
 const handler=createAdminVoiceHandler(db,{OPENAI_API_KEY:'test-not-a-key'},request,Socket);
 const call=async(input,who=identity())=>{actor=who?.sub;const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:'/api/admin-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:!!who,origenIdentity:who});let status,body;await runAsAccount({sub:actor||'anonymous'},()=>handler(req,{writeHead:s=>status=s,end:text=>body=JSON.parse(text)},()=>assert.fail('route missed')));return {status,body};};
 return {handler,call,saved,queries,provider,sockets};
}
test('admin-only test calls, one active session, cross-admin ownership and authoritative usage',async t=>{
 const f=fixture();t.after(()=>f.handler.close());
 assert.equal((await f.call({action:'list'},null)).status,401);assert.equal((await f.call({action:'list'},{sub:'student',permissions:[]})).status,403);assert.equal((await f.call({action:'list'},{sub:'reporter',permissions:['read:activity']})).status,403);assert.equal(f.provider.length,0);
 const c=config();assert.equal((await f.call(c)).status,201);assert.equal((await f.call(config())).status,409);assert.equal((await f.call({action:'status',id:c.id},identity('different'))).status,404);
 f.sockets[0].event({type:'response.done',response:{id:'one',usage}});
 const stopped=await f.call({action:'stop',id:c.id,cost:0});assert.equal(stopped.status,200);assert.ok(stopped.body.cost.total>0);assert.equal(stopped.body.status,'ended');
 assert.equal((await f.call(c)).status,409);assert.equal(f.provider.filter(p=>p.url.endsWith('/realtime/calls')).length,1);assert.ok(f.provider.some(p=>p.url.endsWith('/hangup')));
 assert.ok(!f.queries.some(q=>/origen_family|origen_conversation|origen_topic_notes/.test(q)));
});
test('Live executes published-library tools once and gracefully closes with final usage',async t=>{
 const f=fixture();t.after(()=>f.handler.close());const c={...config(),model:'gpt-live-1'};assert.equal((await f.call(c)).status,201);const socket=f.sockets[0];assert.match(socket.url,/\/attach$/);
 const e={type:'response.event',delegation_id:'d',event:{type:'response.output_item.done',item:{type:'function_call',call_id:'call',name:'search_teaching_library',arguments:'{"topic":"admissions","query":"PIQ"}'}}};socket.event(e);socket.event(e);socket.event({type:'response.event',delegation_id:'d',event:{type:'response.completed',response:{id:'r',model:'gpt-6-luna',usage:{input_tokens:20,output_tokens:20}}}});
 await new Promise(r=>setImmediate(r));assert.equal(socket.sent.filter(e=>e.type==='response.item.create').length,1);assert.equal(socket.sent.filter(e=>e.type==='response.create').length,1);const delivery=socket.sent.filter(e=>e.type==='session.instructions.append');assert.equal(delivery.length,1);assert.match(delivery[0].content,/Warm and patient/);assert.ok(Buffer.byteLength(delivery[0].content)<=480);
 const result=await f.call({action:'stop',id:c.id});assert.equal(result.body.cost.seconds,40);assert.equal(result.body.cost.complete,true);assert.equal(result.body.teachings[1].entries[0].revision,3);
});
test('teaching conversations become reviewable drafts without publishing or library writes; draft generation is idempotent',async t=>{
 const f=fixture();t.after(()=>f.handler.close());const c={...config(),mode:'teach'};await f.call(c);f.sockets[0].event({type:'conversation.item.input_audio_transcription.completed',item_id:'student',transcript:'I explain the circumstances first. Use a warm tone.',usage:{input_tokens:20,output_tokens:10}});
 await f.call({action:'stop',id:c.id});const [a,b]=await Promise.all([f.call({action:'draft',id:c.id}),f.call({action:'draft',id:c.id})]);assert.equal(a.status,200);assert.equal(b.status,200);assert.match(a.body.draft.deliveryStyle,/Warm/);assert.equal(a.body.draft.reviewBy,'');assert.equal(f.provider.filter(p=>p.url.endsWith('/responses')).length,1);assert.ok(!f.queries.some(q=>q.includes('origen_teaching_command')));
 assert.ok(!JSON.stringify([...f.saved.values()]).includes('I explain the circumstances first.'));
});
test('real PostgreSQL migration grants no raw table access and scopes retained runs to the administrator', {skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(f.close);const id=randomUUID();
 const command=(actor,input)=>f.as(actor,()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_admin_voice_command($1::jsonb) AS data',[JSON.stringify(input)])).rows[0].data));
 await command('a',{action:'create',id,data:{status:'active'}});assert.equal((await command('a',{action:'list'})).length,1);assert.equal((await command('b',{action:'list'})).length,0);assert.equal(await command('b',{action:'get',id}),null);
 await assert.rejects(command('a',{action:'create',id:randomUUID(),data:{status:'active'}}),{code:'40001'});
 await assert.rejects(command('b',{action:'update',id,data:{status:'ended'}}),{code:'42501'});
 await assert.rejects(f.runtime.query('SELECT * FROM origen_admin_voice_runs'),{code:'42501'});
 await assert.rejects(f.as('a',()=>f.db.query('SELECT origen_admin_voice_command($1::jsonb)',[JSON.stringify({action:'list'})])),{code:'42501'});
 const evidence={outputTranscriptCharacters:80,browserPlaybackReported:true,matches:[{id:'teaching',revision:8,quote:'Your experiences matter even when they do not appear'}]};
 await command('a',{action:'update',id,data:{status:'ended',evidence}});assert.deepEqual((await command('a',{action:'get',id})).evidence,evidence);assert.equal(await command('b',{action:'get',id}),null);
 await command('a',{action:'update',id,data:{status:'ended',testTranscript:{items:[{role:'user',text:'Synthetic question'}]}}});assert.equal((await command('a',{action:'get',id})).testTranscript.items[0].text,'Synthetic question');await command('a',{action:'update',id,data:{status:'ended',testTranscript:null}});assert.equal((await command('a',{action:'get',id})).testTranscript,null);
 await command('a',{action:'create',id:randomUUID(),data:{status:'active'}});
});
test('stale authentication, revoked access, or unavailable audit cannot start paid calls',async t=>{
 for(const problem of ['stale','revoked','audit']){
  const f=fixture({dbOverride:async sql=>{if(problem==='revoked'&&sql.includes('staff_access_controls'))return {rows:[{blocked:true}]};if(problem==='audit'&&sql.includes('privileged_access_audit'))throw Error('offline');}});t.after(()=>f.handler.close());
  const who=identity();if(problem==='stale')who[AUTH_TIME_CLAIM]=1;
  const result=await f.call(config(),who);assert.equal(result.status,problem==='audit'?503:403);assert.equal(f.provider.length,0);
 }
});
test('cancel while negotiation is pending cleans up exactly the call that was created',async t=>{
 let resolveProvider,providerEntered;const entered=new Promise(r=>providerEntered=r),gate=new Promise(r=>resolveProvider=r);
 const f=fixture({providerOverride:async url=>{if(url.endsWith('/realtime/calls')){providerEntered();await gate;}}});t.after(()=>f.handler.close());
 const c=config(),starting=f.call(c);await entered;const stopping=f.call({action:'stop',id:c.id});await new Promise(r=>setImmediate(r));resolveProvider();
 const [start,stop]=await Promise.all([starting,stopping]);assert.equal(start.status,409);assert.equal(stop.body.status,'ended');assert.equal(f.provider.filter(p=>p.url.endsWith('/hangup')).length,1);assert.equal(f.provider.filter(p=>p.url.endsWith('/realtime/calls')).length,1);
});
test('sideband loss hangs up Realtime and marks accounting incomplete',async t=>{
 const f=fixture();t.after(()=>f.handler.close());const c=config();await f.call(c);f.sockets[0].close();const result=await f.call({action:'stop',id:c.id});assert.equal(result.body.status,'ended');assert.equal(result.body.cost.complete,false);assert.equal(result.body.error,'connection_lost');assert.equal(f.provider.filter(p=>p.url.endsWith('/hangup')).length,1);
});
test('failed draft preparation never becomes a false complete cost or a published teaching',async t=>{
 const f=fixture({providerOverride:async url=>url.endsWith('/responses')?new Response('',{status:503}):undefined});t.after(()=>f.handler.close());const c={...config(),mode:'teach'};await f.call(c);f.sockets[0].event({type:'conversation.item.input_audio_transcription.completed',item_id:'u',transcript:'My own explanation.',usage:{input_tokens:10,output_tokens:10}});await f.call({action:'stop',id:c.id});const result=await f.call({action:'draft',id:c.id});assert.equal(result.body.draft,null);assert.equal(result.body.draftError,'draft_failed');assert.equal(result.body.cost.complete,false);
});
test('browser media-ready handshake greets Live once even when session.started was missed',async t=>{
 const f=fixture();t.after(()=>f.handler.close());const c={...config(),model:'gpt-live-1'};await f.call(c);
 await Promise.all([f.call({action:'ready',id:c.id}),f.call({action:'ready',id:c.id})]);
 assert.equal(f.sockets[0].sent.filter(e=>e.type==='session.commentary.append').length,1);
 const session=JSON.parse(f.provider[0].options.body).session;assert.equal(session.input[0].role,'developer');assert.match(session.input[0].content[0].text,/introduce yourself as Origen/);
 const result=await f.call({action:'stop',id:c.id});assert.equal(result.body.error,'voice_no_output');assert.equal(result.body.evidence.matches.length,0);
});
test('a media-ready session with no output stops automatically instead of silently consuming minutes',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.handler.close());const c={...config(),model:'gpt-live-1'};await f.call(c);await f.call({action:'ready',id:c.id});t.mock.timers.tick(20001);await new Promise(resolve=>setImmediate(resolve));
 const result=await f.call({action:'status',id:c.id});assert.equal(result.body.error,'voice_no_output');assert.equal(result.body.status,'ended');assert.equal(f.sockets[0].sent.filter(e=>e.type==='session.close').length,1);
});
test('only spoken output events create teaching evidence; backend text alone is insufficient',async t=>{
 const explanation="Your experiences matter even when they don't appear on a transcript";
 const f=fixture({dbOverride:async(sql,params)=>sql.includes('origen_read_teachings')?{rows:[{data:[{id:'proof',revision:8,content:{title:'Essay',topic:JSON.parse(params[0]).topic,explanation}}]}]}:undefined});t.after(()=>f.handler.close());const c={...config(),model:'gpt-live-1'};await f.call(c);await f.call({action:'ready',id:c.id});
 const socket=f.sockets[0];socket.event({type:'response.event',event:{type:'response.output_text.delta',delta:explanation}});assert.equal((await f.call({action:'status',id:c.id})).body.evidence.matches.length,0);
 socket.event({type:'session.output_transcript.delta',delta:explanation});socket.event({type:'session.output_audio.delta',delta:'AA=='});
 const result=await f.call({action:'stop',id:c.id});assert.equal(result.body.error,'');assert.equal(result.body.evidence.matches[0].revision,8);assert.equal(result.body.evidence.providerAudioChunks,1);
});

test('full test transcript is opt-in, owner scoped, omitted from lists, and deletable after reconnect',async t=>{
 const f=fixture();t.after(()=>f.handler.close());const c={...config(),model:'gpt-live-1',captureTranscript:true};await f.call(c);
 const socket=f.sockets[0];socket.event({type:'session.input_transcript.delta',delta:'I am worried.'});socket.event({type:'session.output_transcript.delta',delta:'We can take our time.'});socket.event({type:'response.event',event:{type:'response.output_text.delta',delta:'internal backend text'}});
 assert.equal((await f.call({action:'clear-transcript',id:c.id})).status,409);
 const stopped=await f.call({action:'stop',id:c.id});assert.equal(stopped.body.testTranscript.items.length,2);assert.doesNotMatch(JSON.stringify(stopped.body.testTranscript),/backend text/);
 assert.equal((await f.call({action:'status',id:c.id},identity('another'))).status,404);
 await f.handler.close();const list=(await f.call({action:'list'})).body.runs;assert.equal(list[0].hasTestTranscript,true);assert.equal(list[0].testTranscript,undefined);
 assert.equal((await f.call({action:'status',id:c.id})).body.testTranscript.items[0].text,'I am worried.');
 const cleared=await f.call({action:'clear-transcript',id:c.id});assert.equal(cleared.body.testTranscript,null);assert.equal((await f.call({action:'status',id:c.id})).body.testTranscript,null);
 const off=config();await f.call(off);f.sockets.at(-1).event({type:'response.output_audio_transcript.delta',delta:'Not retained'});assert.equal((await f.call({action:'stop',id:off.id})).body.testTranscript,null);
 assert.equal(validateVoiceStart({...config(),mode:'teach',captureTranscript:true}).captureTranscript,false);
});
