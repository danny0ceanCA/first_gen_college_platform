import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createInstitutionRepository,validateInstitution,validateInstitutionPage} from './institutions.mjs';
import {createApp} from './index.mjs';
const representative={firstName:'Alex',workEmail:'alex@college.edu',jobRole:'Admissions outreach'};
const page={name:'Example College',website:'https://college.edu/',description:'Programs and support.',programs:'Science programs',admissions:'See the official portal',financialAid:'Contact financial aid',events:'Campus visits',publicEmail:'outreach@college.edu',links:[{title:'Apply',url:'https://college.edu/apply'}]};
test('institution registration stays separate from family data and requires independent review',async()=>{
 const {pool}=await fixture();const run=createInstitutionRepository(pool,['reviewer','owner']);
 const call=(sub,input)=>run(sub,validateInstitution(input));
 try{
  let result=await call('owner',{action:'register',registrationKey:crypto.randomUUID(),representative,page});const saved=result.institutions[0];
  assert.equal(saved.status,'draft');assert.equal((await pool.query('SELECT * FROM origen_accounts')).rows.length,0);
  assert.deepEqual((await call('foreign',{action:'load'})).institutions,[]);
  await assert.rejects(call('foreign',{action:'save',id:saved.id,revision:1,page}),{status:404});
  await assert.rejects(run(null,{action:'public',slug:saved.slug}),{status:404});
  await call('owner',{action:'submit',id:saved.id,revision:1});
  await assert.rejects(call('foreign',{action:'publish',id:saved.id,revision:1,note:'Approve'}),{status:403});
  await assert.rejects(call('owner',{action:'verify',id:saved.id,revision:1,note:'Self approval'}),{status:403});
  await assert.rejects(call('reviewer',{action:'publish',id:saved.id,revision:1,note:'Approve'}),{status:409});
  const queue=await call('reviewer',{action:'queue'});assert.equal(queue.submissions[0].representatives[0].work_email,representative.workEmail);
  await call('reviewer',{action:'verify',id:saved.id,revision:1,note:'Authorization confirmed independently with official office'});
  await call('reviewer',{action:'publish',id:saved.id,revision:1,note:'Page reviewed'});
  const published=await run(null,{action:'public',slug:saved.slug});assert.deepEqual(published.page,page);
  assert.doesNotMatch(JSON.stringify(published),/alex@college.edu|reviewer|Authorization|auth0/);
 }finally{await pool.end();}
});
test('draft changes preserve approved pages, invalidate changed identities and reject stale saves',async()=>{
 const {pool}=await fixture();const run=createInstitutionRepository(pool,['reviewer']);const call=(sub,input)=>run(sub,validateInstitution(input));
 try{
  const i=(await call('owner',{action:'register',registrationKey:crypto.randomUUID(),representative,page})).institutions[0];
  await call('owner',{action:'submit',id:i.id,revision:1});
  await call('reviewer',{action:'verify',id:i.id,revision:1,note:'Verified via official office'});await call('reviewer',{action:'publish',id:i.id,revision:1,note:'Approved'});
  await call('owner',{action:'save',id:i.id,revision:1,page:{...page,name:'Updated College'}});
  assert.equal((await run(null,{action:'public',slug:i.slug})).page.name,page.name);
  const draft=(await call('owner',{action:'load'})).institutions[0];assert.equal(draft.revision,2);assert.equal(draft.verificationStatus,'pending');
  await assert.rejects(call('owner',{action:'save',id:i.id,revision:1,page}),{status:409});
  await call('owner',{action:'submit',id:i.id,revision:2});
  await call('reviewer',{action:'request-changes',id:i.id,revision:2,note:'Please clarify the institution name'});
  assert.equal((await call('owner',{action:'load'})).institutions[0].reviews[0].note,'Please clarify the institution name');
  assert.equal((await run(null,{action:'public',slug:i.slug})).page.name,page.name);
 }finally{await pool.end();}
});
test('published pages are anonymous while institution registration and reviews require verified identity',async()=>{
 const {pool}=await fixture();const app=createApp({ALLOWED_ORIGINS:'https://origen.example',ALLOW_PREVIEW_VOICE:'true',INSTITUTION_REVIEWER_SUBJECTS:'reviewer'},async token=>({sub:token}),pool,()=>{});
 const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const headers={Origin:'https://origen.example','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/institutions',{method:'POST',headers,body:JSON.stringify({action:'register',registrationKey:crypto.randomUUID(),page,representative})})).status,401);
  const response=await fetch(base+'/api/institutions',{method:'POST',headers:{...headers,Authorization:'Bearer owner'},body:JSON.stringify({action:'register',registrationKey:crypto.randomUUID(),page,representative})});assert.equal(response.status,200);const i=(await response.json()).institutions[0];
  assert.equal((await fetch(base+`/api/institutions/published/${i.slug}`)).status,404);
  const review=createInstitutionRepository(pool,['reviewer']);
  await review('owner',{action:'submit',id:i.id,revision:1});
  await review('reviewer',{action:'verify',id:i.id,revision:1,note:'Confirmed affiliation independently'});
  await review('reviewer',{action:'publish',id:i.id,revision:1,note:'Approved page'});
  const publicResponse=await fetch(base+`/api/institutions/published/${i.slug}`);
  assert.equal(publicResponse.status,200);
  const publicBody=await publicResponse.json();assert.deepEqual(publicBody.page,page);
  assert.doesNotMatch(JSON.stringify(publicBody),/alex@college.edu|Confirmed affiliation|auth0/);
  assert.equal((await fetch(base+'/api/institutions',{method:'POST',headers:{...headers,Authorization:'Bearer owner'},body:JSON.stringify({action:'queue'})})).status,403);
  assert.throws(()=>validateInstitutionPage({...page,website:'javascript:alert(1)'},true),{status:400});
  assert.throws(()=>validateInstitution({action:'register',registrationKey:crypto.randomUUID(),page,representative:{...representative,workEmail:'invalid'}}),{status:400});
  assert.throws(()=>validateInstitution({action:'submit',id:'-'.repeat(36),revision:1}),{status:400});
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
