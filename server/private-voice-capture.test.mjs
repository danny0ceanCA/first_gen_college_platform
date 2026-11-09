import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {captureIdentity,validateCapture,createPrivateVoiceCaptureHandler} from './private-voice-capture.mjs';
import {capturePayload,createVoiceCapture} from '../src/voiceCapture.mjs';

async function requestCapture(handler,subject,input){
 const req=Readable.from([JSON.stringify(input)]);
 Object.assign(req,{url:'/api/private-voice-capture',method:'POST',origenAuthorized:!!subject,origenIdentity:{sub:subject}});
 let status,body;
 await handler(req,{writeHead(value){status=value;},end(value){body=JSON.parse(value);}},()=>assert.fail('Unexpected route'));
 return {status,body};
}

test('all-account capture is discoverable only by authenticated callers and requires the explicit flag',async()=>{
 const database={connect(){assert.fail('Status must not connect to the database');}};
 const enabled=createPrivateVoiceCaptureHandler(database,{ORIGEN_PRIVATE_VOICE_CAPTURE_ALL_ACCOUNTS:'true'});
 const disabled=createPrivateVoiceCaptureHandler(database,{ORIGEN_PRIVATE_VOICE_CAPTURE_ALL_ACCOUNTS:'false'});
 const input={action:'status'};
 assert.deepEqual(await requestCapture(enabled,'fictional-user',input),{status:200,body:{enabled:true}});
 assert.deepEqual(await requestCapture(disabled,'fictional-user',input),{status:200,body:{enabled:false}});
 assert.equal((await requestCapture(enabled,null,input)).status,401);
});

test('all-account capture saves batches idempotently and reads only owned sessions',{skip:!process.env.ORIGEN_CAPTURE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.ORIGEN_CAPTURE_TEST_DATABASE_URL);
 assert.equal(url.hostname,'127.0.0.1','Use only an isolated loopback database');
 const client=new pg.Client({connectionString:url.href});
 await client.connect();
 const schema='capture_test_'+crypto.randomUUID().replaceAll('-','');
 try{
  await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;
   CREATE TABLE origen_accounts(id uuid PRIMARY KEY,auth0_subject text NOT NULL UNIQUE);
   CREATE TABLE origen_students(account_id uuid,id text,PRIMARY KEY(account_id,id));
   CREATE TABLE origen_subject_locks(subject_hash text PRIMARY KEY);
   CREATE TABLE origen_closed_accounts(subject_hash text PRIMARY KEY);
   CREATE FUNCTION origen_current_account_id() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
  await client.query(await readFile(new URL('./migrations/122_private_voice_capture.sql',import.meta.url),'utf8'));
  const first=crypto.randomUUID(),second=crypto.randomUUID(),sessionId=crypto.randomUUID();
  await client.query("INSERT INTO origen_accounts VALUES($1,'first'),($2,'second')",[first,second]);
  await client.query("INSERT INTO origen_students VALUES($1,'own-student'),($2,'other-student')",[first,second]);
  const handler=createPrivateVoiceCaptureHandler({connect:async()=>({query:client.query.bind(client),release(){}})},
   {ORIGEN_PRIVATE_VOICE_CAPTURE_ALL_ACCOUNTS:'true'},()=>assert.fail('All-account mode does not fetch UserInfo'));
  const row=(sequence,studentId)=>({id:crypto.randomUUID(),sessionId,subject:'first',sequence,studentId,
   clientAt:new Date().toISOString(),data:{type:'session.input_transcript.delta',text:'Hola, estudiante de prueba.'}});
  const append={action:'append',events:[row(1,'own-student'),row(2,'other-student')]};
  for(let attempt=0;attempt<2;attempt++)assert.equal((await requestCapture(handler,'first',append)).status,200);
  assert.equal((await requestCapture(handler,'second',append)).status,403);
  const own=(await requestCapture(handler,'first',{action:'read',sessionId})).body.events;
  assert.equal(own.length,2);
  assert.equal(own.find(event=>event.sequence===1).student_id,'own-student');
  assert.equal(own.find(event=>event.sequence===2).student_id,null);
  assert.equal(own[0].data.text,'Hola, estudiante de prueba.');
  assert.deepEqual((await requestCapture(handler,'second',{action:'read',sessionId})).body.events,[]);
 }finally{
  try{await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await client.end();}
 }
});
test('capture requires the exact verified email; request attributes cannot enable another account',async()=>{
 assert.equal(captureIdentity({email:'danielgojeda.1@gmail.com',email_verified:true}),true);
 for(const value of [{email:'other@example.test',email_verified:true},{email:'danielgojeda.1@gmail.com',email_verified:false},{}])assert.equal(captureIdentity(value),false);
 let touched=false,status;
 const req=Readable.from([JSON.stringify({action:'read',email:'danielgojeda.1@gmail.com'})]);Object.assign(req,{url:'/api/private-voice-capture',method:'POST',headers:{authorization:'Bearer fictional'},origenAuthorized:true,origenIdentity:{sub:'other'}});
 await createPrivateVoiceCaptureHandler({connect(){touched=true;}},{AUTH0_DOMAIN:'fictional.auth0.com'},async()=>({ok:true,json:async()=>({sub:'other',email:'other@example.test',email_verified:true})}))(req,{writeHead(s){status=s;},end(){}},()=>{});
 assert.equal(status,403);assert.equal(touched,false);
});
test('capture excludes audio, reasoning and credentials from provider events',()=>{
 assert.equal(capturePayload({type:'response.reasoning.delta',delta:'hidden'}),null);
 assert.equal(capturePayload({type:'response.output_audio.delta',delta:'audio'}),null);
 const event=capturePayload({type:'session.updated',session:{instructions:'Relevant context',client_secret:'secret',model:'test'}});
 assert.equal(event.instructions,'Relevant context');assert.ok(!JSON.stringify(event).includes('secret'));
 const done=capturePayload({type:'response.done',response:{output:[{type:'reasoning',summary:'private'},{type:'function_call',name:'recall_student_context',arguments:'{}'}]}});
 assert.equal(done.calls.length,1);assert.ok(!JSON.stringify(done).includes('private'));
 assert.equal(capturePayload({type:'response.output_audio_transcript.done',transcript:'Spoken words'}).text,'Spoken words');
});
test('capture validation rejects malformed batches and excessive payloads',()=>{
 assert.throws(()=>validateCapture({action:'append',events:[]}));
 assert.throws(()=>validateCapture({action:'read',sessionId:'other-account'}));
 assert.throws(()=>validateCapture({action:'append',events:[{id:'invalid'}]}));
 assert.deepEqual(validateCapture({action:'read'}),{action:'read'});
});
test('queued events cannot cross an authenticated account change',async()=>{
 let touched=false,status;
 const req=Readable.from([JSON.stringify({action:'append',events:[{id:crypto.randomUUID(),sessionId:crypto.randomUUID(),subject:'previous-account',sequence:1,clientAt:new Date().toISOString(),data:{type:'diagnostic'}}]})]);
 Object.assign(req,{url:'/api/private-voice-capture',method:'POST',headers:{authorization:'Bearer fictional'},origenAuthorized:true,origenIdentity:{sub:'current-account'}});
 await createPrivateVoiceCaptureHandler({connect(){touched=true;}},{AUTH0_DOMAIN:'fictional.auth0.com'},async()=>({ok:true,json:async()=>({sub:'current-account',email:'danielgojeda.1@gmail.com',email_verified:true})}))(req,{writeHead(s){status=s;},end(){}},()=>{});
 assert.equal(status,403);assert.equal(touched,false);
});
test('large Unicode context is fragmented losslessly into keepalive-safe batches',async()=>{
 const batches=[],capture=createVoiceCapture(async events=>batches.push(events));
 capture.enable(true);const instructions='Información y contexto. '.repeat(5000);
 capture.event({type:'context.received',instructions},{sessionId:crypto.randomUUID()});
 for(let i=0;i<25;i++)await capture.flush();
 const events=batches.flat();assert.ok(events.length>1);
 for(const batch of batches){assert.ok(Buffer.byteLength(JSON.stringify(batch))<50000);validateCapture({action:'append',events:batch});}
 const reconstructed=JSON.parse(events.map(e=>e.data.text).join(''));
 assert.equal(reconstructed.instructions,instructions);
});
test('operator binding accepts only its authenticated subject without a UserInfo request',async()=>{
 for(const [sub,expected] of [['bound-subject',503],['other-subject',403]]){
  let status,lookups=0;const req=Readable.from(['{"action":"read"}']);
  Object.assign(req,{url:'/api/private-voice-capture',method:'POST',headers:{},origenAuthorized:true,origenIdentity:{sub}});
  await createPrivateVoiceCaptureHandler(null,{ORIGEN_PRIVATE_VOICE_CAPTURE_SUBJECT:'bound-subject'},async()=>{lookups++;throw Error('must_not_call');})(req,{writeHead(value){status=value;},end(){}},()=>{});
  // A matching identity reaches the unavailable database; others are denied before it.
  assert.equal(status,expected);assert.equal(lookups,0);
 }
});
test('non-retryable authorization failures pause uploads instead of looping',async()=>{
 let uploads=0;const capture=createVoiceCapture(async()=>{uploads++;throw Object.assign(Error('denied'),{retryable:false});});
 capture.enable(true);capture.event({type:'diagnostic',event:'test'},{sessionId:crypto.randomUUID()});await capture.flush();
 capture.event({type:'diagnostic',event:'another'},{sessionId:crypto.randomUUID()});await capture.flush();
 assert.equal(uploads,1);
});
