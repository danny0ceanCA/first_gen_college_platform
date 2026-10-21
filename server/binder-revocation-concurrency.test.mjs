import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';

async function sharedBinder(f){
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Synthetic' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/binder-sharing',{studentId:'alex',...input});
 const preview=()=>student({action:'preview',connectionId:connection,topics:['options','costs'],entryIds:f.notes.slice(0,2)});
 const card=await preview();await student({action:'publish',previewId:card.previewId,confirmed:true});
 return {account,connection,preview,grant:(await student({action:'status'})).grants[0].id};
}
async function waitFor(f,sql,values=[]){
 const deadline=Date.now()+5000;
 do{const row=(await f.owner.query(sql,values)).rows[0];if(row)return row;await pause(10);}while(Date.now()<deadline);
 throw Error('Expected database lock wait was not reached');
}
async function barrier(f,table,event,condition){
 const key=randomInt(1,2000000000);
 await f.owner.query(`CREATE FUNCTION test_lock_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM pg_advisory_xact_lock(2141,${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER test_lock_barrier BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION test_lock_barrier()`);
 const gate=await f.owner.connect();await gate.query('SELECT pg_advisory_lock(2141,$1)',[key]);let released=false;
 return {
  entered:()=>waitFor(f,"SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=2141 AND objid=$1 AND NOT granted",[key]),
  release:async()=>{if(!released){released=true;await gate.query('SELECT pg_advisory_unlock(2141,$1)',[key]);gate.release();}},
 };
}

test('student stop controls complete while coordinator read audit is waiting',{skip:!process.env.DATABASE_TEST_URL,timeout:60000},async t=>{
 for(const action of ['revoke','revoke-all','remove-topic','withdraw','help','connection-withdraw'])await t.test(action,async()=>{
  const f=await coordinatorPilotFixture({runtimePoolSize:4});let gate,read,stop;
  try{
   const b=await sharedBinder(f);
   const before=await f.call('staff','/api/coordinator-binders',{organizationId:f.org,action:'read',grantId:b.grant});
   gate=await barrier(f,'origen_binder_share_events','INSERT',"NEW.action='read'");
   read=f.request('staff','/api/coordinator-binders',{organizationId:f.org,action:'read',grantId:b.grant});
   const reader=await gate.entered();
   stop=action==='connection-withdraw'
    ?f.request('other','/api/coordinator-connections',{studentId:'alex',action:'withdraw',connectionId:b.connection})
    :f.request('other','/api/binder-sharing',{studentId:'alex',action,grantId:b.grant,topic:'options',requested:true,itemId:before.entries.find(x=>x.topic==='options').id});
   await waitFor(f,'SELECT pid FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))',[reader.pid]);
   await gate.release();
   const [r,s]=await Promise.all([read,stop]);assert.equal(r.status,200,JSON.stringify(r));assert.equal(s.status,200,JSON.stringify(s));
   const after=await f.request('staff','/api/coordinator-binders',{organizationId:f.org,action:'read',grantId:b.grant});
   if(['revoke','revoke-all','connection-withdraw'].includes(action))assert.equal(after.status,404);
   else if(action==='help'){assert.equal(after.status,200);assert.equal(after.body.entries.length,2);assert.equal(after.body.helpRequested,true);}
   else{assert.equal(after.status,200);assert.equal(after.body.entries.filter(x=>x.topic==='options').length,0);}
  }finally{await gate?.release();await Promise.allSettled([read,stop].filter(Boolean));await f.close();}
 });
});

test('suspension completes while publication waits for its institution',{skip:!process.env.DATABASE_TEST_URL,timeout:20000},async()=>{
 const f=await coordinatorPilotFixture({runtimePoolSize:4});let gate,suspend,publish;
 try{
  const b=await sharedBinder(f),card=await b.preview();
  gate=await barrier(f,'origen_coordinator_organizations','UPDATE',"NEW.status='suspended'");
  suspend=f.request('reviewer','/api/coordinator-access',{action:'suspend-organization',id:f.org});
  const suspender=await gate.entered();publish=f.request('other','/api/binder-sharing',{studentId:'alex',action:'publish',previewId:card.previewId,confirmed:true});
  await waitFor(f,'SELECT pid FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))',[suspender.pid]);
  await gate.release();
  const [s,p]=await Promise.all([suspend,publish]);assert.equal(s.status,200,JSON.stringify(s));assert.equal(p.status,403,JSON.stringify(p));
  assert.equal((await f.owner.query('SELECT status FROM origen_coordinator_organizations WHERE institution_id=$1',[f.org])).rows[0].status,'suspended');
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_share_grants WHERE status='active'")).rows[0].n,0);
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  assert.equal((await f.request('staff','/api/coordinator-binders',{organizationId:f.org,action:'read',grantId:b.grant})).status,403);
 }finally{await gate?.release();await Promise.allSettled([suspend,publish].filter(Boolean));await f.close();}
});
