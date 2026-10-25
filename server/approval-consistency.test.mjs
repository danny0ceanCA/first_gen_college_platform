import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {defaultCoordinatorOrganization} from '../src/coordinatorOrganizationDefault.mjs';
const api='/api/coordinator-access',inst='/api/institutions';
const options={skip:!process.env.DATABASE_TEST_URL,timeout:45000};
async function registered(f){
 const application=(await f.call('applicant',api,{action:'submit-application',displayName:'Synthetic Advisor',organizationName:'Old Organization Name',organizationWebsite:'https://example.org/',jobRole:'Advisor'})).application;
 const data=await f.call('applicant',inst,signupOrganization(application,'Synthetic guidance.',application.id,true));
 return {application,organization:data.institutions.find(i=>i.id===data.registeredInstitutionId)};
}
test('mixed approval writes cannot exhaust connections needed by unrelated account work',options,async()=>{
 const f=await coordinatorRegistrationFixture({runtimePoolSize:3});let gate,burst=[],account;
 try{
  const {organization:o}=await registered(f);
  await f.call('applicant',inst,{action:'submit',id:o.id,revision:o.revision});
  await f.call('reviewer',inst,{action:'verify',id:o.id,revision:o.revision,note:'Checked.'});
  gate=await f.owner.connect();await gate.query('BEGIN');await gate.query('LOCK TABLE origen_institutions IN ACCESS EXCLUSIVE MODE');
  burst=Array.from({length:20},(_,i)=>i%2?f.request('reviewer',inst,{action:'verify',id:o.id,revision:o.revision,note:'Checked.'}):f.request('reviewer',api,{action:'approve-organization',id:o.id,revision:0}));
  const deadline=Date.now()+5000;let blocked=0;
  while(Date.now()<deadline){blocked=(await f.owner.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[f.role])).rows[0].n;if(blocked>=2)break;await pause(20);}
  assert.ok(blocked>=2,'Fixture must reach the held database lock');
  account=f.as('reader',()=>f.db.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',['reader']));
  const responsive=await Promise.race([account.then(r=>r.rows.length===1),pause(1500).then(()=>false)]);
  await gate.query('ROLLBACK');gate.release();gate=null;
  const results=await Promise.all(burst);await account;
  assert.equal(responsive,true,'Approval writes exhausted the runtime connection pool');
  assert.equal(results.filter(r=>r.status===429).length,18,'The two endpoints must share one admission limit');
  assert.equal(results.filter(r=>r.status===200).length,2);
  assert.equal((await f.request('reviewer',api,{action:'suspend-organization',id:o.id})).status,200);
 }finally{if(gate){await gate.query('ROLLBACK');gate.release();}await Promise.allSettled([...burst,...(account?[account]:[])]);await f.close();}
});
test('stale affiliation review cannot overwrite a newer resolved decision',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {organization:o}=await registered(f);
 for(const action of ['submit','verify','publish'])await f.call(action==='submit'?'applicant':'reviewer',inst,{action,id:o.id,revision:o.revision,note:'Independently checked.'});
 await f.call('applicant',inst,{action:'request-affiliation',requestId:randomUUID(),parentId:o.id,parentName:o.page.name,parentWebsite:o.page.website,unitName:'Synthetic unit',unitType:'program',firstName:'Synthetic Advisor',workEmail:'applicant@example.test',jobRole:'Advisor'});
 const original=(await f.call('reviewer',inst,{action:'load'})).affiliationRequests[0];
 const first={action:'review-affiliation',id:original.id,revision:original.revision??1,status:'verified',note:'Affiliation confirmed.'};
 await f.call('reviewer',inst,first);
 const current=(await f.call('reviewer',inst,{action:'load'})).affiliationRequests[0];
 await f.call('reviewer',inst,{...first,revision:current.revision??2,status:'resolved',note:'Membership confirmed.'});
 const stale=await f.request('reviewer',inst,{...first,status:'changes-requested',note:'Decision from a stale tab.'});
 assert.equal(stale.status,409,'Stale affiliation review replaced a newer decision');
 assert.equal(stale.body.error,'affiliation_changed');
 assert.equal((await f.call('reviewer',inst,{action:'load'})).affiliationRequests[0].status,'resolved');
});
test('coordinator approval follows the registered organization after a reviewed name correction',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const {application,organization:o}=await registered(f);
 await f.call('applicant',inst,{action:'submit',id:o.id,revision:1});
 await f.call('reviewer',inst,{action:'request-changes',id:o.id,revision:1,note:'Use the registered legal organization name.'});
 await f.call('applicant',inst,{action:'save',id:o.id,revision:2,page:{...o.page,name:'Correct Legal Organization'}});
 await f.call('applicant',inst,{action:'submit',id:o.id,revision:3});
 await f.call('reviewer',inst,{action:'verify',id:o.id,revision:3,note:'Corrected name confirmed.'});
 await f.call('reviewer',api,{action:'approve-organization',id:o.id,revision:0});
 const item=(await f.call('reviewer',api,{action:'applications'})).applications.find(a=>a.id===application.id);
 const orgs=(await f.call('reviewer',api,{action:'application-organizations',id:application.id,search:item.registeredOrganizationName||item.organizationName})).organizations;
 assert.ok(orgs.some(org=>org.id===o.id),'Approved organization disappeared from the default applicant search after its name changed');
 assert.equal(item.registeredInstitutionId,o.id);
 assert.equal(item.organizationName,'Old Organization Name','Original application claims remain available to the reviewer');
 assert.equal(defaultCoordinatorOrganization(item.organizationName,[...orgs,{id:randomUUID(),name:item.organizationName}],item.registeredInstitutionId),o.id,'Registered ID must win over another organization with the original name');
 await f.call('reviewer',api,{action:'approve-application',id:item.id,institutionId:o.id,reviewNote:'Corrected organization and affiliation verified.'});
 assert.equal((await f.call('applicant',api,{action:'profile',id:o.id})).profile.status,'active');
});
