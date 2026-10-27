import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsCoordinatorActor,runAsAccount} from './account-isolation.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';
import {validateConnectionInput,runConnectionCommand,assertCoordinatorLinkingReady,createCoordinatorConnectionsHandler} from './coordinator-connections.mjs';
import {createApp} from './index.mjs';
import {MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {normalizeCoordinatorCode,redactCoordinatorCodes,redactCoordinatorTurns} from '../src/coordinatorCodes.mjs';
import {validateMemory} from './history.mjs';
import {validateLiveChange} from './live-memory.mjs';
import {coordinatorVoiceTools} from '../src/coordinatorVoiceTools.mjs';
import {coordinatorLinkTools} from './coordinator-voice-tools.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('codes normalize exact separators and case, never repair ambiguous characters',()=>{
 assert.equal(normalizeCoordinatorCode(' abCde - 23456 '),'ABCDE23456');
 for(const s of ['ABCDE-12345','ABCDE-O2345','ABCDE2345','alpha bravo charlie delta echo two three four five six'])assert.equal(normalizeCoordinatorCode(s),null);
 const args=validateConnectionInput({action:'lookup',contextId:randomUUID(),sequence:1,code:'abcde23456',studentId:'forged',networkHash:'forged',confirmed:true});
 assert.equal(args.codeHash,hash('ABCDE23456'));assert.equal(args.networkHash,undefined);assert.equal(args.studentId,undefined);assert.equal(args.confirmed,undefined);
 assert.throws(()=>validateConnectionInput({action:'confirm',contextId:randomUUID(),sequence:0,challengeId:randomUUID(),confirmed:true,topics:['family']}));
 assert.deepEqual(coordinatorLinkTools.map(t=>t.name),['lookup_coordinator_code','prepare_coordinator_connection']);
 for(const text of ['My coordinator code is alpha bravo charlie','Mi coordinador tiene la clave abcde23456','ABCDE-23456','abcde23456'])assert.ok(!redactCoordinatorCodes(text).includes(text));
 assert.equal(redactCoordinatorCodes('I want to study physics.'),'I want to study physics.');
 const turns=[{role:'user',text:'My coordinator has a code'},{role:'assistant',text:'What is it?'},{role:'user',text:'alpha bravo charlie delta echo two three four five six'},{role:'user',text:'I want to study physics.'}];
 const retained=redactCoordinatorTurns(turns);assert.equal(retained[2].text,'[Connection code omitted]');assert.equal(retained[3].text,turns[3].text);assert.deepEqual(redactCoordinatorTurns(retained),retained);
 assert.throws(()=>validateLiveChange({kind:'create',category:'goal',content:'ABCDE-23456'}));
 assert.equal(validateMemory({id:'summary',studentId:'alex',mode:'planning',summary:'Code ABCDE-23456',date:new Date().toISOString(),sources:[]}).summary,'Code [connection code omitted]');
});
test('ordinary transfer-planning prose survives code redaction and summary validation',()=>{
 const prose='Alex wants to understand which classes transfer. Review study plans, assessment requirements and the department website. The counselor visit is the key next step.';
 assert.equal(redactCoordinatorCodes(prose),prose);
 assert.equal(redactCoordinatorCodes('Understand the next steps.'),'Understand the next steps.');
 assert.equal(validateMemory({id:'transfer-summary',studentId:'alex',mode:'planning',summary:prose,date:new Date().toISOString(),sources:[]}).summary,prose);
 assert.doesNotThrow(()=>validateLiveChange({kind:'create',category:'goal',content:'Understand which courses transfer.'}));
});

test('code cues and recognizable code formats remain private, including alphabetic codes',()=>{
 for(const text of ['ABCDE23456','abcde23456','abcde 23456','abcde-fghjk','ABCDEFGHJK','ABCDE FGHJK','The code is abcdefghjk','La clave es abcde fghjk','a b c d e f g h j k']){
  assert.match(redactCoordinatorCodes(text),/\[connection code omitted\]/,text);
 }
 const turns=[{role:'assistant',text:'What is your coordinator connection code?'},{role:'user',text:'abcdefghjk'},{role:'assistant',text:'Let us understand your study plans.'}];
 const redacted=redactCoordinatorTurns(turns);
 assert.equal(redacted[1].text,'[Connection code omitted]');
 assert.equal(redacted[2].text,turns[2].text);
 assert.deepEqual(redactCoordinatorTurns(redacted),redacted);
});

test('voice tools deduplicate, ignore stale results and cannot confirm',async()=>{
 const requests=[],cards=[];let resolveLookup;
 const controller=coordinatorVoiceTools({studentId:'alex',onClear:()=>{},onPrepared:c=>cards.push(c),post:async body=>{requests.push(body);if(body.action==='open')return {contextId:randomUUID()};if(body.action==='lookup')return new Promise(r=>resolveLookup=r);return {};}});
 controller.configure(true);controller.begin('turn-1');await new Promise(r=>setImmediate(r));
 const item={name:'lookup_coordinator_code',call_id:'one',arguments:JSON.stringify({code:'ABCDE23456'})};
 const first=controller.invoke(item,1),duplicate=controller.invoke(item,1);await new Promise(r=>setImmediate(r));
 controller.begin('turn-2');resolveLookup({challengeId:randomUUID()});
 assert.equal((await first).status,'cancelled');assert.equal((await duplicate).status,'cancelled');assert.equal(requests.filter(r=>r.action==='lookup').length,1);assert.equal(cards.length,0);
 assert.equal(await controller.invoke({...item,name:'confirm_coordinator_connection'}),null);
 controller.stop();assert.equal((await controller.invoke(item)).status,'cancelled');assert.ok(requests.some(r=>r.action==='close'));
});
test('connection challenges enforce pilot, ownership, turns, expiration and acceptance without binder access',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());
 const env={ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true'};await assertCoordinatorLinkingReady(f.runtime,env);
 const org=randomUUID();for(const sub of ['owner','staff','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Community Pilot'}]);
 for(const [sub,role] of [['owner','owner'],['staff','outreach']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[org,sub,role]);
 const provision=(sub,action,extra={},admin=false)=>f.as(sub,()=>runAsCoordinatorActor(sub,{administrator:admin},()=>runCoordinatorCommand(f.db,{action,id:org,...extra})));
 await provision('reviewer','approve-organization',{},true);await provision('owner','enable-member',{subject:'staff'});
 let code=(await provision('staff','rotate-code')).code;
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const run=async(action,extra={},sub='other')=>f.as(sub,()=>runConnectionCommand(f.db,{...validateConnectionInput({action,...extra}),networkHash:hash('synthetic-network'),voiceEnabled:true}));
 const staff=(action,extra={},sub='staff')=>f.as(sub,()=>runAsCoordinatorActor(sub,{},()=>runConnectionCommand(f.db,validateConnectionInput({action,organizationId:org,...extra}))));
 const seed=async()=>{await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic') ON CONFLICT(subject_hash) DO UPDATE SET status='adult'",[hash('other')]);};
 const open=async(channel='screen')=>({...await run('open',{studentId:'alex',channel}),sequence:0});
 const prepare=async ctx=>{const found=await run('lookup',{...ctx,code});return {...ctx,...await run('prepare',{...ctx,challengeId:found.challengeId})};};
 const confirm=card=>run('confirm',{...card,confirmed:true,topics:['options']});
 await t.test('current account permission allows owned student profiles without operator enrollment',async()=>{
  await assert.rejects(open(),{status:403});await seed();await run('available',{studentId:'alex'});
  await run('available',{studentId:'sam'});await assert.rejects(run('available',{studentId:'missing'}),{status:403});await assert.rejects(run('available',{studentId:'alex'},'reader'),{status:403});
  await f.owner.query("UPDATE origen_eligibility SET status='approved' WHERE subject_hash=$1",[hash('other')]);await assert.rejects(open(),{status:403});await seed();
 });
 let connection;
 await t.test('lookup and prepare disclose identity only; confirmation is idempotent, awaiting staff',async()=>{
  await f.save('family-private','PRIVATE_FAMILY_SENTINEL',{studentId:null,sub:'other'});
  const ctx=await open(),card=await prepare(ctx);assert.equal(card.coordinator.name,'staff');assert.equal(card.studentName,'alex');
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_connections')).rows[0].n,0);
  await assert.rejects(run('confirm',{...card,confirmed:false,topics:[]}),{status:400});
  await assert.rejects(f.as('other',()=>runConnectionCommand(f.db,{action:'confirm',...card,topics:[]})),{status:403});
  const results=await Promise.all([confirm(card),confirm(card)]);connection=results[0].connectionId;assert.equal(results[1].connectionId,connection);assert.equal(results[0].status,'requested');
  const inbox=await staff('inbox');assert.equal(inbox.connections.length,1);assert.deepEqual(Object.keys(inbox.connections[0]).sort(),['displayName','expiresAt','id','status','topics']);assert.ok(!JSON.stringify(inbox).includes('PRIVATE_FAMILY'));
  await assert.rejects(staff('accept',{connectionId:connection},'owner'),{status:404});
  await assert.rejects(f.as('staff',()=>runConnectionCommand(f.db,{action:'accept',organizationId:org,connectionId:connection})),{code:'42501'});
  assert.equal((await staff('accept',{connectionId:connection})).status,'accepted');assert.equal((await staff('accept',{connectionId:connection})).status,'accepted');
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_share_grants')).rows[0].n,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_publications')).rows[0].n,0);
  assert.deepEqual((await f.as('staff',()=>f.db.query('SELECT * FROM origen_conversation_summaries'))).rows,[]);
  await run('withdraw',{studentId:'alex',connectionId:connection});assert.equal((await run('list',{studentId:'alex'})).connections[0].status,'revoked');
 });
 await t.test('new voice turn, student scope, close, cancellation and challenge expiry invalidate confirmation',async()=>{
  let ctx=await open('voice');await run('turn',{...ctx,sequence:1,turnId:'first'});ctx.sequence=1;const card=await prepare(ctx);
  await run('turn',{...ctx,sequence:2,turnId:'second'});await assert.rejects(confirm(card),{status:409});await assert.rejects(run('turn',{...ctx,sequence:1,turnId:'first'}),{status:409});
  let fresh=await prepare(await open());await assert.rejects(run('prepare',{...fresh},'reader'),{status:403});await run('cancel',fresh);await assert.rejects(confirm(fresh),{status:409});
  fresh=await prepare(await open());await f.owner.query("UPDATE origen_coordinator_link_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[fresh.challengeId]);await assert.rejects(confirm(fresh),{status:409});
  fresh=await prepare(await open());await open();await assert.rejects(confirm(fresh),{status:403});
  fresh=await prepare(await open());await run('close',fresh);await assert.rejects(confirm(fresh),{status:409});
 });
 await t.test('code rotation and identity changes invalidate cards, pending requests expire',async()=>{
  let card=await prepare(await open());code=(await provision('staff','rotate-code')).code;await assert.rejects(confirm(card),{status:404});
  card=await prepare(await open());await provision('staff','save-profile',{displayName:'Updated coordinator'});await assert.rejects(confirm(card),{status:409});
  // Reset lookup budget for this independent lifecycle case.
  await f.owner.query('DELETE FROM origen_coordinator_lookup_budgets');
  const result=await confirm(await prepare(await open()));connection=result.connectionId;
  await f.owner.query("UPDATE origen_binder_connections SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1",[connection]);
  await assert.rejects(staff('accept',{connectionId:connection}),{status:409});assert.equal((await staff('inbox')).connections.length,0);
 });
 await t.test('lookup enumeration is bounded and invalid or revoked codes use the same response',async()=>{
  await f.owner.query('DELETE FROM origen_coordinator_lookup_budgets');const ctx=await open();
  for(let i=0;i<10;i++)await assert.rejects(run('lookup',{...ctx,code:'ABCDE-99999'}),{status:404,message:'coordinator_unavailable'});
  await assert.rejects(run('lookup',{...ctx,code}),{status:429});
  await f.owner.query('DELETE FROM origen_coordinator_lookup_budgets');await provision('staff','revoke-code');await assert.rejects(run('lookup',{...ctx,code}),{status:404,message:'coordinator_unavailable'});
 });
 await t.test('network budgets are shared and approval revocation cannot revive a previous request',async()=>{
  code=(await provision('staff','rotate-code')).code;await f.owner.query('DELETE FROM origen_coordinator_lookup_budgets');
  await f.owner.query('INSERT INTO origen_coordinator_lookup_budgets(key,attempts) VALUES($1,100)',['n:'+hash('synthetic-network')]);
  await assert.rejects(run('lookup',{...await open(),code}),{status:429});await f.owner.query('DELETE FROM origen_coordinator_lookup_budgets');
  const card=await prepare(await open());const created=await confirm(card);await staff('accept',{connectionId:created.connectionId});
  await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[hash('other')]);
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_connections WHERE id=$1',[created.connectionId])).rows[0].status,'revoked');
  await seed();await assert.rejects(confirm(card),{status:403});assert.equal((await staff('inbox')).connections.length,0);
  const newCard=await prepare(await open());await f.family('other',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'parent'}});await f.family('other',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
  await assert.rejects(confirm(newCard),{status:403});await open();
 });
 await t.test('HTTP separates student requests from fresh staff approval and keeps codes out of logs',async()=>{
  await seed();const now=Math.floor(Date.now()/1000);let identity={sub:'staff',iat:now,[MFA_TIME_CLAIM]:now,[AUTH_TIME_CLAIM]:now},verified=true;
  const handler=createCoordinatorConnectionsHandler(f.db,{...env,AUTH0_DOMAIN:'synthetic.auth0.com'},async()=>({ok:true,json:async()=>({sub:identity.sub,email:'synthetic@example.test',email_verified:verified})}));
  const server=createServer((req,res)=>{req.origenIdentity=identity;req.origenAuthorized=true;void runAsAccount(identity,()=>handler(req,res,()=>{res.writeHead(404);res.end();}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-connections`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal((await send({action:'inbox',organizationId:org})).status,200);
   delete identity[MFA_TIME_CLAIM];assert.equal((await(await send({action:'inbox',organizationId:org,mfa:true})).json()).error,'staff_mfa_required');identity[MFA_TIME_CLAIM]=now;
   verified=false;assert.equal((await send({action:'inbox',organizationId:org})).status,403);verified=true;
   identity[AUTH_TIME_CLAIM]=now-43201;assert.equal((await(await send({action:'accept',organizationId:org,connectionId:randomUUID()})).json()).error,'reauthentication_required');
   identity={sub:'other',iat:now};assert.equal((await send({action:'open',studentId:'alex',channel:'voice',voiceEnabled:true})).status,403);
   assert.equal((await send({action:'open',studentId:'alex',channel:'screen'})).status,200);
  }finally{await new Promise(r=>server.close(r));}
  const logs=[],app=createApp(env,async()=>({sub:'other'}),f.db,line=>logs.push(line)),gateway=createServer(app);await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  try{
   const send=(path,body)=>fetch(`http://127.0.0.1:${gateway.address().port}/api/${path}`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
   const response=await send('coordinator-connections',{action:'open',studentId:'alex',channel:'screen'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const ctx=await response.json();
   await send('coordinator-connections',{action:'lookup',contextId:ctx.contextId,sequence:0,code:'ABCDE-99999'});
   for(const path of ['coordinator-binders','coordinator-feedback','coordinator-notifications'])assert.equal((await send(path,{})).status,['coordinator-feedback','coordinator-notifications'].includes(path)?400:503);
   await app.flushLogs();assert.ok(!JSON.stringify(logs).includes('ABCDE-99999'));assert.ok(!JSON.stringify(logs).includes('PRIVATE_FAMILY'));
  }finally{await new Promise(r=>gateway.close(r));await app.flushLogs();}
 });
});
