import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';

const api='/api/coordinator-access',institutions='/api/institutions';
const submission={action:'submit-application',displayName:'Synthetic Advisor',organizationName:'Community Futures',organizationWebsite:'https://example.org/',jobRole:'Advisor'};
const options={skip:!process.env.DATABASE_TEST_URL};
async function registered(f){
 const application=(await f.call('applicant',api,submission)).application;
 const org=await f.call('applicant',institutions,signupOrganization(application,'College guidance.',application.id,true));
 const id=org.registeredInstitutionId;
 await f.call('applicant',institutions,{action:'submit',id,revision:1});
 await f.call('reviewer',institutions,{action:'verify',id,revision:1,note:'Affiliation checked independently.'});
 return {application,id};
}

test('a requested-changes decision invalidates a stale publish even after resubmission',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {id}=await registered(f);
 await f.call('reviewer',institutions,{action:'request-changes',id,revision:1,note:'Clarify services before publishing.'});
 const current=(await f.call('applicant',institutions,{action:'load'})).institutions.find(i=>i.id===id);
 await f.call('applicant',institutions,{action:'submit',id,revision:current.revision});
 const stale=await f.request('reviewer',institutions,{action:'publish',id,revision:1,note:'Decision from an old tab.'});
 assert.equal(stale.status,409,'Old review must not overwrite the newer requested-changes decision');
 assert.equal(stale.body.error,'institution_changed');
 assert.equal((await f.owner.query('SELECT published FROM origen_institutions WHERE id=$1',[id])).rows[0].published,null);
 await f.call('reviewer',institutions,{action:'publish',id,revision:current.revision,note:'Reviewed the resubmission.'});
});

test('coordinator approval survives a lost response without duplicate activation or decisions',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {application,id}=await registered(f);
 await f.call('reviewer',api,{action:'approve-organization',id});
 const decision={action:'approve-application',id:application.id,institutionId:id,reviewNote:'Affiliation checked.\n\nWelcome.'};
 await assert.rejects(fetch(f.base+api,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':'reviewer','x-synthetic-secret':f.transportSecret,'x-synthetic-drop-response':'true'},body:JSON.stringify(decision)}));
 assert.equal((await f.call('applicant',api,{action:'application-status'})).application.status,'approved');
 const before=(await f.owner.query('SELECT reviewed_at FROM origen_coordinator_applications WHERE id=$1',[application.id])).rows[0];
 assert.equal((await f.request('reviewer',api,decision)).status,200,'An identical retry must acknowledge the committed approval');
 const events=()=>f.owner.query("SELECT count(*)::int n FROM origen_institution_access_events WHERE action='coordinator-approve-application' AND target_subject='applicant'");
 assert.equal((await events()).rows[0].n,1);
 assert.deepEqual((await f.owner.query('SELECT reviewed_at FROM origen_coordinator_applications WHERE id=$1',[application.id])).rows[0],before);
 await f.call('applicant',api,{action:'disable-member',id,subject:'applicant'});
 assert.equal((await f.request('reviewer',api,decision)).status,200);
 assert.equal((await f.owner.query("SELECT status FROM origen_coordinator_profiles WHERE auth0_subject='applicant'")).rows[0].status,'disabled','Retry must not reactivate later-disabled access');
 assert.equal((await f.request('reviewer',api,{...decision,reviewNote:'Different decision'})).status,409);
 assert.equal((await f.request('reviewer',api,{...decision,action:'decline-application'})).status,409);
 f.actor('second-reviewer',{reviewer:true});
 assert.equal((await f.request('second-reviewer',api,decision)).status,409);
 const declined=(await f.call('invited',api,submission)).application;
 const decline={action:'decline-application',id:declined.id,reviewNote:'Missing affiliation evidence.'};
 await f.call('reviewer',api,decline);
 assert.equal((await f.request('reviewer',api,decline)).status,200);
});

test('admin organization access queue reaches every organization beyond the first 100',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status,created_at) SELECT gen_random_uuid(),'queue-'||n,jsonb_build_object('name',CASE WHEN n=1 THEN 'Old Community Center' ELSE 'Center '||n END),'verified',now()+n*interval '1 second' FROM generate_series(1,105) n");
 const old=(await f.owner.query("SELECT id FROM origen_institutions WHERE draft->>'name'='Old Community Center'")).rows[0].id;
 assert.ok(!(await f.call('reviewer',api,{action:'overview'})).organizations.some(o=>o.id===old));
 let after='',ids=[];
 do{
  const result=await f.call('reviewer',api,{action:'organization-queue',after});
  assert.ok(result.organizations.length<=50);ids.push(...result.organizations.map(o=>o.id));after=result.next||'';
 }while(after);
 assert.equal(ids.length,105);assert.equal(new Set(ids).size,105);assert.ok(ids.includes(old));
 const found=await f.call('reviewer',api,{action:'organization-queue',search:'old community'});
 assert.deepEqual(found.organizations.map(o=>o.id),[old]);assert.equal(found.next,null);
 await f.call('reviewer',api,{action:'approve-organization',id:old});
 assert.equal((await f.call('reviewer',api,{action:'organization-queue',search:'old community'})).organizations[0].pilotStatus,'active');
 assert.equal((await f.request('applicant',api,{action:'organization-queue'})).status,403);
 for(const input of [{after:'invalid'},{search:'x'.repeat(201)},{search:'bad\ninput'}])assert.equal((await f.request('reviewer',api,{action:'organization-queue',...input})).status,400);
 const missing=await f.call('reviewer',api,{action:'organization-queue',after:randomUUID(),search:'no matching name'});assert.deepEqual(missing.organizations,[]);
});
