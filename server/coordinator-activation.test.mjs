import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {coordinatorIdentityEvents,createCoordinatorIdentityHandler,activationConfiguration,adminCoordinatorActivation,assertCoordinatorActivationReady} from './coordinator-activation.mjs';
import {runAsAccount,runAsAnalytics,runIdentityEvents} from './account-isolation.mjs';
import {createApp} from './index.mjs';
import {createAdminHandler} from './admin.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {syncCoordinatorActivation} from '../scripts/sync-coordinator-activation.mjs';

const env={AUTH0_COORDINATOR_EVENTS_SECRET:'s'.repeat(43),AUTH0_COORDINATOR_CLIENT_IDS:'syntheticWebClient'},clients=['syntheticWebClient'];
const log=(type='scp',extra={})=>({type,date:'2026-01-01T12:00:00.000Z',user_id:'invited',client_id:clients[0],...extra});
const event=(kind='password-set',occurredAt='2026-01-01T12:00:00.000Z',subject='invited')=>({subject,kind,occurredAt});
async function call(handler,{body=JSON.stringify([{data:log()}]),authorization=`Bearer ${env.AUTH0_COORDINATOR_EVENTS_SECRET}`,type='application/json',method='POST'}={}){
 const req=Readable.from([body]);Object.assign(req,{method,headers:{authorization,'content-type':type}});const out={};
 await handler(req,{writeHead(status,headers){out.status=status;out.headers=headers;},end(body){out.body=JSON.parse(body);}});return out;
}

test('Auth0 evidence accepts supported formats and strips all unrelated personal data',()=>{
 const records=[{data:log('scp',{email:'DO_NOT_STORE',ip:'DO_NOT_STORE',details:{password:'DO_NOT_STORE'}})},{data:log('s')},log('f'),log('scpr'),log('ss'),log('s',{client_id:'otherApplication'})];
 for(const raw of [JSON.stringify(records),records.map(x=>JSON.stringify(x)).join('\n')])assert.deepEqual(coordinatorIdentityEvents(raw,clients),[event(),event('sign-in')]);
 assert.deepEqual(coordinatorIdentityEvents(JSON.stringify({data:log()}),clients),[event()]);
 assert.deepEqual(coordinatorIdentityEvents(JSON.stringify([log('s',{client_id:null})]),clients),[]);
 for(const value of ['','[]','null','[null]',JSON.stringify({data:log('scp',{date:'tomorrow'})}),JSON.stringify(log('s',{user_id:'bad\0subject'})),JSON.stringify(log('scp',{date:'2999-01-01T00:00:00Z'})),JSON.stringify(Array(1001).fill(log()))])assert.throws(()=>coordinatorIdentityEvents(value,clients),{status:400});
});

test('webhook authenticates before reading or writing and fails closed',async()=>{
 let writes=0;const handler=createCoordinatorIdentityHandler({query:async()=>{writes++;return {rows:[]};}},env);
 for(const authorization of ['',null,'Bearer invalid','Bearer '+ 'x'.repeat(400)])assert.equal((await call(handler,{authorization})).status,401);
 assert.equal((await call(handler,{method:'GET'})).status,405);
 assert.equal((await call(handler,{type:'text/plain'})).status,415);
 assert.equal((await call(handler,{body:'malformed'})).status,400);
 assert.equal((await call(handler,{body:'x'.repeat(1048577)})).status,413);assert.equal(writes,0);
 const ok=await call(handler);assert.equal(ok.status,200);assert.equal(ok.headers['Cache-Control'],'no-store');assert.equal(writes,1);
 assert.equal((await call(createCoordinatorIdentityHandler({query(){throw Error('never');}},{}))).status,503);
 assert.equal((await call(createCoordinatorIdentityHandler({query(){throw Error('private_sql_password');}},env))).body.error,'identity_tracking_unavailable');
 assert.equal(activationConfiguration({...env,AUTH0_COORDINATOR_EVENTS_SECRET:'short'}).enabled,false);
 assert.equal(activationConfiguration({...env,AUTH0_COORDINATOR_CLIENT_IDS:''}).enabled,false);
 assert.throws(()=>runAsAccount({sub:'browser'},()=>runIdentityEvents(()=>{})),/identity_events_not_available/);
 await assertCoordinatorActivationReady(null,{});
 await assert.rejects(assertCoordinatorActivationReady({query:async()=>({rows:[{ready:false}]})},env),/migration_required/);
});

test('gateway mounts the secret-authenticated webhook outside browser JWT and permission flows',async()=>{
 const records=[];let jwtChecks=0;
 const server=createServer(createApp({...env,ALLOWED_ORIGINS:'https://synthetic.example'},async()=>{jwtChecks++;throw Error('never');},{query:async(sql,args)=>{assert.match(sql,/origen_record_coordinator_identity_events/);records.push(JSON.parse(args[0]));return {rows:[]};}},()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/auth0/coordinator-events`,options={method:'POST',headers:{Authorization:`Bearer ${env.AUTH0_COORDINATOR_EVENTS_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify([{data:log()}])};
  assert.equal((await fetch(url,options)).status,200);assert.equal(jwtChecks,0);assert.deepEqual(records,[[event()]]);
  assert.equal((await fetch(url,{...options,headers:{...options.headers,Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer browserJWT'}})).status,401);assert.equal(records.length,1);
 }finally{await new Promise(r=>server.close(r));}
});

test('operator replay filters identities and supports empty retained history',async()=>{
 const batches=[],owner={query:async()=>({rows:[{auth0_subject:'invited'},{auth0_subject:'older'}]})};
 const result=await syncCoordinatorActivation({owner,database:{query:async(_,args)=>batches.push(JSON.parse(args[0]))},domain:'synthetic.auth0.com',clients,readLogs:async subject=>subject==='older'?[]:[log('scp'),log('s'),log('s',{client_id:'elsewhere'})]});
 assert.equal(result.coordinatorsChecked,2);assert.equal(result.confirmedEvents,2);assert.deepEqual(batches,[[event(),event('sign-in')]]);
 await assert.rejects(syncCoordinatorActivation({owner,database:{},domain:'synthetic.auth0.com',clients,readLogs:async()=>[log('scp',{user_id:'different'})]}),/identity_mismatch/);
});

test('activation milestones, replay, privilege gates and erasure on restricted PostgreSQL',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture(),id=randomUUID();
 try{
  await assertCoordinatorActivationReady(f.runtime,env);
  await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('invited','Synthetic','invited@example.test','Guide')");
  await f.owner.query("INSERT INTO origen_coordinator_applications(id,auth0_subject,display_name,verified_email,organization_name,organization_website,job_role,status) VALUES($1,'invited','Synthetic','invited@example.test','Synthetic','','Guide','approved')",[id]);
  const ingest=events=>runIdentityEvents(()=>f.db.query('SELECT origen_record_coordinator_identity_events($1::jsonb)',[JSON.stringify(events)]));
  const read=()=>f.as('admin',()=>runAsAnalytics(()=>adminCoordinatorActivation(f.db,{id},env)));
  await t.test('absent evidence is null; repeated, concurrent and delayed batches preserve earliest milestones',async()=>{
   assert.equal((await read()).passwordSetAt,null);assert.equal((await read()).firstSignInAt,null);
   await Promise.all([ingest([event('password-set','2026-01-02T00:00:00Z')]),ingest([event('sign-in','2026-01-03T00:00:00Z')]),ingest([event('password-set','2026-01-01T00:00:00Z')])]);
   await ingest([event('sign-in','2026-01-01T01:00:00Z'),event('password-set','2026-02-01T00:00:00Z')]);
   await ingest([event('sign-in','2026-01-01T01:00:00Z')]);
   const data=await read();assert.equal(new Date(data.passwordSetAt).toISOString(),'2026-01-01T00:00:00.000Z');assert.equal(new Date(data.firstSignInAt).toISOString(),'2026-01-01T01:00:00.000Z');assert.ok(data.lastReceivedAt);assert.equal(data.trackingEnabled,true);
   assert.doesNotMatch(JSON.stringify(data),/invited|example.test|passwordHash|auth0_subject/);
  });
  await t.test('unrelated users, browser writes, reads without analytics, and blocked admins are denied',async()=>{
   await ingest([event('sign-in','2026-01-01T00:00:00Z','other')]);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_coordinator_activation')).rows[0].n,1);
   for(const table of ['origen_coordinator_activation','origen_coordinator_identity_stream'])await assert.rejects(f.as('invited',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
   await assert.rejects(f.as('invited',()=>f.db.query('SELECT origen_record_coordinator_identity_events($1::jsonb)',[JSON.stringify([event()])])),{code:'42501'});
   await assert.rejects(f.as('invited',()=>adminCoordinatorActivation(f.db,{id},env)),{code:'42501'});
   await f.owner.query('INSERT INTO origen_staff_access_controls(subject_hash,blocked) VALUES($1,true)',[createHash('sha256').update('admin').digest('hex')]);await assert.rejects(read(),{code:'42501'});await f.owner.query('DELETE FROM origen_staff_access_controls');
  });
  await t.test('real HTTP delivery commits before an admin sees it, and an invalid batch is atomic',async()=>{
   const server=createServer(createApp(env,async token=>{if(token!=='syntheticAdminToken')throw Error('invalid');return {sub:'admin',permissions:['read:institutions'],iat:Math.floor(Date.now()/1000)};},f.db,()=>{}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
   try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/api/auth0/coordinator-events',{method:'POST',headers:{Authorization:`Bearer ${env.AUTH0_COORDINATOR_EVENTS_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify([{data:log('s',{date:'2026-01-01T00:30:00Z'})}])});assert.equal(response.status,200);
    const status=await fetch(base+'/api/admin',{method:'POST',headers:{Authorization:'Bearer syntheticAdminToken','Content-Type':'application/json'},body:JSON.stringify({action:'coordinator-activation',id})});assert.equal(status.status,200);assert.equal(new Date((await status.json()).firstSignInAt).toISOString(),'2026-01-01T00:30:00.000Z');
    await assert.rejects(ingest([event('password-set','2025-01-01T00:00:00Z'),event('unknown')]));assert.equal(new Date((await read()).passwordSetAt).toISOString(),'2026-01-01T00:00:00.000Z');
   }finally{await new Promise(r=>server.close(r));}
  });
  await t.test('admin action enforces read:institutions and returns no-store; invalid or missing records never leak',async()=>{
   const handler=createAdminHandler(f.db,env);
   const request=permissions=>f.as('admin',async()=>{
    const req=Readable.from([JSON.stringify({action:'coordinator-activation',id})]);Object.assign(req,{url:'/api/admin',method:'POST',headers:{},origenAuthorized:true,origenIdentity:{sub:'admin',permissions,iat:Math.floor(Date.now()/1000)}});const out={};
    await handler(req,{writeHead(status,headers){out.status=status;out.headers=headers;},end(body){out.body=JSON.parse(body);}},()=>{});return out;
   });
   assert.equal((await request(['read:activity'])).status,403);const response=await request(['read:institutions']);assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.body.id,id);
   await assert.rejects(adminCoordinatorActivation(f.db,{id:'bad'},env),{status:400});await assert.rejects(f.as('admin',()=>runAsAnalytics(()=>adminCoordinatorActivation(f.db,{id:randomUUID()},env))),{status:404});
  });
  await t.test('closed or erased accounts cannot be recreated by late deliveries',async()=>{
   await f.owner.query('INSERT INTO origen_closed_accounts(subject_hash) VALUES($1)',[createHash('sha256').update('invited').digest('hex')]);await ingest([event('sign-in','2025-01-01T00:00:00Z')]);assert.equal(new Date((await read()).firstSignInAt).toISOString(),'2026-01-01T00:30:00.000Z');
   await f.owner.query("DELETE FROM origen_coordinator_applications WHERE auth0_subject='invited'");await f.owner.query("DELETE FROM origen_institution_representatives WHERE auth0_subject='invited'");await ingest([event()]);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_coordinator_activation')).rows[0].n,0);
  });
 }finally{await f.close();}
});
