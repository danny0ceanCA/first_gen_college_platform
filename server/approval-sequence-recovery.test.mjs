import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {loadCoordinatorApplicationPage} from '../src/coordinatorApplicationQueue.mjs';
const api='/api/coordinator-access',inst='/api/institutions';
const options={skip:!process.env.DATABASE_TEST_URL};
async function registered(f){
 const application=(await f.call('applicant',api,{action:'submit-application',displayName:'Synthetic Advisor',organizationName:'Sequence Test',organizationWebsite:'https://example.org/',jobRole:'Advisor'})).application;
 const registered=await f.call('applicant',inst,signupOrganization(application,'Synthetic college guidance.',application.id,true));
 const id=registered.registeredInstitutionId;
 await f.call('applicant',inst,{action:'submit',id,revision:1});
 await f.call('reviewer',inst,{action:'verify',id,revision:1,note:'Independent verification.'});
 return {application,id};
}
async function loseResponse(f,path,input){
 await assert.rejects(fetch(f.base+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':'reviewer','x-synthetic-secret':f.transportSecret,'x-synthetic-drop-response':'true'},body:JSON.stringify(input)}));
}
test('lost publication response can be retried without duplicate reviews or notifications',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {id}=await registered(f),decision={action:'publish',id,revision:1,note:'Approved for publication.'};
 await loseResponse(f,inst,decision);
 const state=async()=>({page:(await f.owner.query('SELECT published_at,revision,status FROM origen_institutions WHERE id=$1',[id])).rows[0],reviews:(await f.owner.query("SELECT count(*)::int n FROM origen_institution_reviews WHERE institution_id=$1 AND action='publish'",[id])).rows[0].n,notifications:(await f.owner.query("SELECT count(*)::int n FROM origen_institution_notifications WHERE institution_id=$1 AND kind='publish'",[id])).rows[0].n});
 const before=await state();assert.equal(before.page.status,'published');
 const retries=await Promise.all(Array.from({length:5},()=>f.request('reviewer',inst,decision)));
 assert.ok(retries.every(r=>r.status===429||r.status===200&&r.body.replayed===true));
 for(const result of retries.filter(r=>r.status===429))assert.equal((await f.call('reviewer',inst,decision)).replayed,true);
 assert.deepEqual(await state(),before);
 f.actor('other-reviewer',{reviewer:true});
 assert.equal((await f.request('other-reviewer',inst,decision)).status,409);
 assert.equal((await f.request('reviewer',inst,{...decision,note:'Different decision.'})).status,409);
 assert.equal((await f.request('applicant',inst,decision)).status,403);
 await f.call('applicant',inst,{action:'submit',id,revision:1});
 await f.call('other-reviewer',inst,{...decision,note:'A later publication decision.'});
 assert.equal((await f.request('reviewer',inst,decision)).status,409,'An earlier review must not be mistaken for the current publication');
 await f.call('applicant',inst,{action:'unpublish',id,revision:1});
 assert.equal((await f.request('reviewer',inst,decision)).status,409);
 assert.equal((await f.owner.query('SELECT published FROM origen_institutions WHERE id=$1',[id])).rows[0].published,null);
});
test('lost organization approval response is acknowledged only for the unchanged decision',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {id}=await registered(f),decision={action:'approve-organization',id,revision:0};
 await loseResponse(f,api,decision);
 const state=async()=>(await f.owner.query('SELECT * FROM origen_coordinator_organizations WHERE institution_id=$1',[id])).rows[0];
 const before=await state();
 assert.equal((await f.call('reviewer',api,decision)).replayed,true);assert.deepEqual(await state(),before);
 f.actor('other-reviewer',{reviewer:true});
 assert.equal((await f.request('other-reviewer',api,decision)).status,409);
 assert.equal((await f.request('applicant',api,decision)).status,403);
 await f.call('reviewer',api,{action:'suspend-organization',id});
 assert.equal((await f.request('reviewer',api,decision)).status,409);assert.equal((await state()).status,'suspended');
 const fresh={...decision,revision:(await state()).revision};
 await f.call('reviewer',api,fresh);
 assert.equal((await f.request('reviewer',api,decision)).status,409,'An older approval must not be confused with a later reactivation');
 assert.equal((await f.call('reviewer',api,fresh)).replayed,true);
 await f.call('applicant',inst,{action:'archive',id,revision:1});
 assert.equal((await f.request('reviewer',api,fresh)).status,403);
});
test('approving the last coordinator on a later page returns to remaining applications',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {id,application}=await registered(f);
 await f.call('reviewer',api,{action:'approve-organization',id,revision:0});
 await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) SELECT 'sequence-'||n,'Synthetic '||n,'sequence-'||n||'@example.test','Advisor' FROM generate_series(1,50) n");
 await f.owner.query("INSERT INTO origen_coordinator_applications(id,auth0_subject,display_name,verified_email,organization_name,organization_website,job_role) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'sequence-'||n,'Synthetic '||n,'sequence-'||n||'@example.test','Sequence Test','https://example.org/','Advisor' FROM generate_series(1,50) n");
 const request=input=>f.call('reviewer',api,input);
 const first=await loadCoordinatorApplicationPage(request),cursor=first.applications[49].id;
 const second=await loadCoordinatorApplicationPage(request,cursor);
 assert.deepEqual(second.applications.map(a=>a.id),[application.id]);assert.equal(second.after,cursor);
 await f.call('reviewer',api,{action:'approve-application',id:application.id,institutionId:id,reviewNote:'Welcome.'});
 const recovered=await loadCoordinatorApplicationPage(request,cursor);
 assert.equal(recovered.after,'');assert.equal(recovered.applications.length,50);
 assert.ok(recovered.applications.every(a=>a.id!==application.id));
});
test('empty coordinator queue fallback is bounded and preserves request failures',async()=>{
 const calls=[];
 assert.deepEqual(await loadCoordinatorApplicationPage(async input=>{calls.push(input.after);return {applications:[]};},'last-page'),{applications:[],after:''});
 assert.deepEqual(calls,['last-page','']);
 let count=0;
 await assert.rejects(loadCoordinatorApplicationPage(async()=>{if(++count===1)return {applications:[]};throw new Error('network failed');},'last-page'),/network failed/);
});
