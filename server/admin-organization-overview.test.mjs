import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {runAsAnalytics} from './account-isolation.mjs';
import {adminOrganizationOverview} from './admin-organization-overview.mjs';
import {createAdminHandler} from './admin.mjs';

test('organization overview validates identifiers and supported periods before querying',async()=>{
 const db={query(){throw Error('unexpected query');}};
 for(const input of [{},{organizationId:'not-an-id'},{organizationId:randomUUID(),days:0},{organizationId:randomUUID(),days:'30'}])await assert.rejects(adminOrganizationOverview(db,input),{status:400});
});

test('organization metrics and voice attribution with real restricted PostgreSQL', {skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorPilotFixture();
 try{
  const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
  const parent=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='reader'")).rows[0].id;
  const profiles=(await f.owner.query('SELECT id,auth0_subject FROM origen_coordinator_profiles WHERE institution_id=$1',[f.org])).rows;
  const staff=profiles.find(p=>p.auth0_subject==='staff').id,colleague=profiles.find(p=>p.auth0_subject==='colleague').id;
  const connection=async(student,coordinator,status='accepted',owner=account,expired=false)=>{
   const id=randomUUID();await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,created_at,accepted_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '2 days',CASE WHEN $5='accepted' THEN now()-interval '1 day' ELSE NULL END,now()+CASE WHEN $7 THEN interval '-1 day' ELSE interval '30 days' END)",[id,owner,student,coordinator,status,randomUUID(),expired]);return id;
  };
  const first=await connection('alex',staff),second=await connection('alex',colleague);await connection('sam',staff);await connection('sam',colleague,'requested');
  await connection('alex',staff,'accepted',parent); // A parent-owned profile is never a linked student metric.
  await f.family('other',{action:'save-student',student:{id:'expired',name:'Expired',stage:'College',color:'peach'}});
  await connection('expired',staff,'accepted',account,true);
  await f.owner.query("INSERT INTO origen_ai_configurations(id,model_id,operation,prompt_hash,tool_schema_hash,policy_version,application_revision) VALUES('synthetic-config','synthetic-model','voice','synthetic','synthetic','test','test')");
  const segment=async({owner=account,role='student',kind='student',student='alex',session=randomUUID(),ordinal=0}={})=>{
   const id=randomUUID();await f.owner.query('INSERT INTO origen_guidance_sessions(account_id,id,actor_role,initial_language) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[owner,session,role,'en']);
   await f.owner.query("INSERT INTO origen_guidance_segments(account_id,session_id,id,ordinal,topic,target_kind,student_id,configuration_id,configuration_state) VALUES($1,$2,$3,$4,'planning',$5,$6,'synthetic-config','applied')",[owner,session,id,ordinal,kind,kind==='student'?student:null]);return {id,session,owner};
  };
  const handler=createAdminHandler(f.db,{});
  const request=async(sub,permissions,data,path='/api/admin')=>f.as(sub,async()=>{
   const req=Readable.from([JSON.stringify(data)]);Object.assign(req,{url:path,method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub,permissions,iat:Math.floor(Date.now()/1000)}});
   const out={};const res={writeHead(status,headers){out.status=status;out.headers=headers;},end(body){out.body=body?JSON.parse(body):null;}};
   await handler(req,res,()=>{throw Error('unexpected next');});return out;
  });
  const overview=(days=30)=>f.as('reviewer',()=>runAsAnalytics(()=>adminOrganizationOverview(f.db,{organizationId:f.org,days})));
  const start=async(seg,sub='other',id=randomUUID())=>{
   const response=await request(sub,[],{action:'voice_start',id,topic:'planning',...(seg?{segmentId:seg.id}:{})},'/api/activity');assert.equal(response.status,204);return id;
  };
  const credit=async(id,seconds)=>f.owner.query('UPDATE origen_voice_activity SET seconds=$2 WHERE id=$1',[id,seconds]);
  await t.test('current counts deduplicate students and reject expired or parent-owned connections',async()=>{
   const data=await overview();assert.equal(data.activeCoordinators,2);assert.equal(data.totalCoordinators,2);assert.equal(data.linkedStudents,2);assert.equal(data.pendingConnections,1);assert.equal(data.sharedBinders,0);assert.equal(data.voiceMinutes,0);assert.ok(data.voiceTrackingSince);
   assert.deepEqual(Object.keys(data).sort(),['organizationId','generatedAt','days','periodStart','periodEnd','activeCoordinators','totalCoordinators','linkedStudents','sharedBinders','pendingConnections','voiceMinutes','voiceCalls','voiceTrackingSince'].sort());
  });
  await t.test('published binders count students once across multiple coordinators and disappear on revocation',async()=>{
   for(const connectionId of [first,second]){
    const preview=await f.call('other','/api/binder-sharing',{action:'preview',studentId:'alex',connectionId,topics:['options'],entryIds:[f.notes[0]]});
    await f.call('other','/api/binder-sharing',{action:'publish',studentId:'alex',previewId:preview.previewId,confirmed:true});
   }
   assert.equal((await overview()).sharedBinders,1);
   await f.owner.query("UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1,current_publication_id=NULL WHERE account_id=$1",[account]);
   assert.equal((await overview()).sharedBinders,0);assert.equal((await overview()).linkedStudents,2);
  });
  await t.test('one call is attributed once per org, duplicate starts do not multiply credit',async()=>{
   const seg=await segment(),id=await start(seg);await start(seg,'other',id);await credit(id,120);
   assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_organization_voice_attributions WHERE voice_id=$1',[id])).rows[0].n,1);
   assert.equal((await overview()).voiceMinutes,2);assert.equal((await overview()).voiceCalls,1);
  });
  await t.test('family, unresolved, parent, cross-account and legacy calls receive no attribution',async()=>{
   for(const seg of [await segment({kind:'family'}),await segment({kind:'unresolved'}),await segment({role:'parent'}),undefined])await credit(await start(seg),600);
   const parentSeg=await segment({owner:parent,role:'parent'});await credit(await start(parentSeg,'reader'),600);await credit(await start(parentSeg),600);
   const data=await overview();assert.equal(data.voiceMinutes,2);assert.equal(data.voiceCalls,1);
  });
  await t.test('adding a family segment removes the whole mixed call from reporting',async()=>{
   const seg=await segment();await credit(await start(seg),180);assert.equal((await overview()).voiceMinutes,5);
   await segment({session:seg.session,ordinal:1,kind:'family'});assert.equal((await overview()).voiceMinutes,2);
  });
  await t.test('date filters apply to voice activity and empty orgs show real zeroes',async()=>{
   const seg=await segment(),id=await start(seg);await credit(id,60);await f.owner.query("UPDATE origen_voice_activity SET started_at=now()-interval '15 days' WHERE id=$1",[id]);
   assert.equal((await overview(7)).voiceMinutes,2);assert.equal((await overview(30)).voiceMinutes,3);
   const empty=randomUUID();await f.owner.query("INSERT INTO origen_institutions(id,slug,draft) VALUES($1,$2,$3)",[empty,empty,{name:'Empty organization'}]);
   const data=await f.as('reviewer',()=>runAsAnalytics(()=>adminOrganizationOverview(f.db,{organizationId:empty})));
   assert.equal(data.activeCoordinators,0);assert.equal(data.linkedStudents,0);assert.equal(data.voiceMinutes,0);
   await assert.rejects(f.as('reviewer',()=>runAsAnalytics(()=>adminOrganizationOverview(f.db,{organizationId:randomUUID()}))),{status:404});
  });
  await t.test('revocation changes live counts without retroactively reassigning recorded calls',async()=>{
   await f.owner.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=$1",[first]);
   assert.equal((await overview()).linkedStudents,2); // Alex still has colleague's connection.
   await f.owner.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE account_id=$1 AND student_id='alex'",[account]);
   assert.equal((await overview()).linkedStudents,1);assert.equal((await overview()).voiceMinutes,3);
   await credit(await start(await segment()),60);assert.equal((await overview()).voiceMinutes,3);
  });
  await t.test('separate organizations each receive a call once; suspending one does not change the other',async()=>{
   const org=randomUUID(),profile=randomUUID();
   await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Second synthetic organization'}]);
   await f.owner.query("INSERT INTO origen_coordinator_organizations(institution_id,status,approved_by) VALUES($1,'active','reviewer')",[org]);
   await f.owner.query("INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,'staff','outreach')",[org]);
   await f.owner.query("INSERT INTO origen_coordinator_profiles(id,institution_id,auth0_subject,display_name,status) VALUES($1,$2,'staff','Synthetic','active')",[profile,org]);
   await connection('sam',profile);
   const otherOverview=()=>f.as('reviewer',()=>runAsAnalytics(()=>adminOrganizationOverview(f.db,{organizationId:org})));
   const seg=await segment({student:'sam'}),id=await start(seg);await credit(id,60);
   assert.equal((await otherOverview()).voiceMinutes,1);assert.equal((await otherOverview()).linkedStudents,1);assert.equal((await overview()).voiceMinutes,4);
   await f.owner.query("UPDATE origen_coordinator_organizations SET status='suspended' WHERE institution_id=$1",[org]);
   const suspended=await otherOverview();assert.equal(suspended.activeCoordinators,0);assert.equal(suspended.linkedStudents,0);assert.equal(suspended.voiceMinutes,1);
   assert.equal((await overview()).activeCoordinators,2);assert.equal((await overview()).linkedStudents,1);
   await f.owner.query('DELETE FROM origen_voice_activity WHERE id=$1',[id]);assert.equal((await overview()).voiceMinutes,3);
  });
  await t.test('admin permission and audit gate; no MFA required; raw attribution stays private',async()=>{
   const input={action:'organization-overview',organizationId:f.org};
   assert.equal((await request('staff',[],input)).status,403);
   assert.equal((await request('reviewer',['read:activity'],input)).status,403);
   const response=await request('reviewer',['read:institutions'],input);assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');
   assert.equal((await request('reviewer',['read:institutions'],{...input,days:999})).status,400);
   await assert.rejects(f.as('staff',()=>f.db.query('SELECT origen_admin_organization_overview($1,30)',[f.org])),{code:'42501'});
   await assert.rejects(f.as('reviewer',()=>f.db.query('SELECT * FROM origen_organization_voice_attributions')),{code:'42501'});
   assert.ok((await f.owner.query("SELECT count(*)::int AS n FROM origen_privileged_access_audit WHERE action='organization-overview'")).rows[0].n>=3);
  });
  await t.test('guidance deletion clears organization attribution without deleting account usage',async()=>{
   const seg=await segment({student:'sam'}),id=await start(seg);await credit(id,60);
   assert.equal((await overview()).voiceMinutes,4);
   await f.owner.query('DELETE FROM origen_guidance_segments WHERE account_id=$1 AND id=$2',[account,seg.id]);
   assert.equal((await overview()).voiceMinutes,3);
   const activity=(await f.owner.query('SELECT seconds,guidance_segment_id FROM origen_voice_activity WHERE id=$1',[id])).rows[0];
   assert.equal(activity.seconds,60);assert.equal(activity.guidance_segment_id,null);
   assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_organization_voice_attributions WHERE voice_id=$1',[id])).rows[0].n,0);
  });
  await t.test('account deletion removes its attributed usage',async()=>{
   await f.owner.query('DELETE FROM origen_accounts WHERE id=$1',[account]);assert.equal((await overview()).voiceMinutes,0);
   assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_organization_voice_attributions')).rows[0].n,0);
  });
 }finally{await f.close();}
});
