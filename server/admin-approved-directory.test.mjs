import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {runAsAnalytics} from './account-isolation.mjs';
import {adminApprovedDirectory} from './admin-approved-directory.mjs';
import {createAdminHandler} from './admin.mjs';

test('directory input is validated before database access',async()=>{
 const db={query(){throw Error('unexpected query');}};
 for(const input of [{kind:'unknown'},{kind:'coordinators',after:'bad'},{kind:'coordinators',search:'x'.repeat(201)},{kind:'organizations',search:'\n'},{action:'coordinator-overview',id:randomUUID(),days:1},{action:'coordinator-overview',id:'bad'}])await assert.rejects(adminApprovedDirectory(db,input),{status:400});
});

test('approved directory and coordinator metrics on restricted PostgreSQL',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorPilotFixture();
 try{
  const application=randomUUID(),account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
  const profile=(await f.owner.query("SELECT id FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$1",[f.org])).rows[0].id;
  await f.owner.query("INSERT INTO origen_coordinator_applications(id,auth0_subject,display_name,verified_email,organization_name,organization_website,job_role,status,institution_id,reviewed_at) VALUES($1,'staff','Approved Person','staff@example.test','Old name','','Counselor','approved',$2,now())",[application,f.org]);
  const query=input=>f.as('reviewer',()=>runAsAnalytics(()=>adminApprovedDirectory(f.db,input)));
  const overview=()=>query({action:'coordinator-overview',id:application,days:30});
  const connection=randomUUID();
  await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,accepted_at,expires_at) VALUES($1,$2,'alex',$3,'accepted',$4,now(),now()+interval '30 days')",[connection,account,profile,randomUUID()]);
  await f.owner.query("INSERT INTO origen_binder_connections(account_id,student_id,coordinator_id,status,request_id,expires_at) VALUES($1,'sam',$2,'requested',$3,now()+interval '30 days')",[account,profile,randomUUID()]);
  const preview=await f.call('other','/api/binder-sharing',{action:'preview',studentId:'alex',connectionId:connection,topics:['options'],entryIds:[f.notes[0]]});
  const publication=await f.call('other','/api/binder-sharing',{action:'publish',studentId:'alex',previewId:preview.previewId,confirmed:true});
  const grant=(await f.owner.query('SELECT id FROM origen_binder_share_grants WHERE connection_id=$1',[connection])).rows[0].id;
  const guidance=await f.call('staff','/api/coordinator-feedback',{action:'staff-create',organizationId:f.org,grantId:grant,publicationId:publication.publicationId,topic:'options',kind:'guidance',body:'Private guidance body must not appear in metrics',resourceUrl:'',requestId:randomUUID()});
  await t.test('approved records are searchable using current organization name',async()=>{
   const orgs=await query({kind:'organizations'});assert.equal(orgs.items.length,1);assert.equal(orgs.items[0].id,f.org);
   const list=await query({kind:'coordinators',search:'Synthetic Community Center'});assert.equal(list.items.length,1);assert.equal(list.items[0].id,application);assert.equal(list.items[0].status,'active');
   assert.equal((await query({kind:'coordinators',search:'absent'})).items.length,0);
  });
  await t.test('metrics count current sharing and only current reviewed guidance versions',async()=>{
   let data=await overview();assert.equal(data.linkedStudents,1);assert.equal(data.sharedBinders,1);assert.equal(data.pendingConnections,1);assert.equal(data.guidanceEntries,1);assert.equal(data.reviewedEntries,0);
   await f.call('other','/api/coordinator-feedback',{action:'student-review',studentId:'alex',feedbackId:guidance.id,version:1,requestId:randomUUID()});
   assert.equal((await overview()).reviewedEntries,1);
   await f.call('staff','/api/coordinator-feedback',{action:'staff-edit',organizationId:f.org,grantId:grant,feedbackId:guidance.id,version:1,kind:'guidance',body:'Updated guidance',resourceUrl:'',requestId:randomUUID()});
   assert.equal((await overview()).reviewedEntries,0);
   assert.ok(!JSON.stringify(data).includes('Private guidance'));
   await f.owner.query("UPDATE origen_coordinator_feedback SET created_at=now()-interval '15 days' WHERE id=$1",[guidance.id]);
   assert.equal((await query({action:'coordinator-overview',id:application,days:7})).guidanceEntries,0);
   assert.equal((await overview()).guidanceEntries,1);
  });
  await t.test('revoked sharing and suspended access change counts without hiding approval',async()=>{
   await f.owner.query("UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1,current_publication_id=NULL WHERE id=$1",[grant]);
   assert.equal((await overview()).sharedBinders,0);
   await f.owner.query("UPDATE origen_coordinator_organizations SET status='suspended' WHERE institution_id=$1",[f.org]);
   const data=await overview();assert.equal(data.active,false);assert.equal(data.linkedStudents,0);assert.equal(data.pendingConnections,0);
   assert.equal((await query({kind:'coordinators'})).items[0].status,'inactive');
   assert.equal((await query({kind:'organizations'})).items[0].status,'suspended');
   await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);
   assert.equal((await query({kind:'coordinators'})).items[0].id,application);assert.equal((await overview()).sharedBinders,0);
  });
  await t.test('approved pagination includes every record once and excludes pending applications',async()=>{
   for(let n=0;n<55;n++){
    const sub=`directory-test-${n}`;
    await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,'Synthetic',$2,'Test')",[sub,`${sub}@example.test`]);
    await f.owner.query("INSERT INTO origen_coordinator_applications(auth0_subject,display_name,verified_email,organization_name,organization_website,job_role,status,institution_id) VALUES($1,'Synthetic',$2,'Directory','','Test',$3,$4)",[sub,`${sub}@example.test`,n===54?'pending':'approved',f.org]);
   }
   const first=await query({kind:'coordinators'}),second=await query({kind:'coordinators',after:first.next});
   assert.equal(first.items.length,50);assert.equal(second.items.length,5);assert.equal(second.next,null);
   assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,55);
   assert.ok(!(await query({kind:'coordinators',search:'directory-test-54@'})).items.length);
  });
  await t.test('admin API permission gate and raw table isolation',async()=>{
   const handler=createAdminHandler(f.db,{});
   const request=permissions=>f.as('reviewer',async()=>{
    const req=Readable.from([JSON.stringify({action:'approved-directory',kind:'coordinators'})]);Object.assign(req,{url:'/api/admin',method:'POST',headers:{},origenAuthorized:true,origenIdentity:{sub:'reviewer',permissions,iat:Math.floor(Date.now()/1000)}});
    const out={};await handler(req,{writeHead(status,headers){out.status=status;out.headers=headers;},end(body){out.body=JSON.parse(body);}},()=>{});return out;
   });
   assert.equal((await request(['read:activity'])).status,403);assert.equal((await request(['read:institutions'])).status,200);
   assert.equal((await request(['read:institutions'])).headers['Cache-Control'],'no-store');
   await assert.rejects(f.as('staff',()=>adminApprovedDirectory(f.db,{kind:'coordinators'})),{code:'42501'});
   await assert.rejects(f.as('reviewer',()=>f.db.query('SELECT * FROM origen_coordinator_applications')),{code:'42501'});
   await assert.rejects(query({action:'coordinator-overview',id:randomUUID()}),{status:404});
  });
 }finally{await f.close();}
});
