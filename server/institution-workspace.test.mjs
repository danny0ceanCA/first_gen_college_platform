import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './family-fixture.mjs';
import {createInstitutionRepository,validateInstitution} from './institutions.mjs';
const representative={firstName:'Alex',workEmail:'alex@college.example',jobRole:'Outreach'};
const page={name:'College',website:'https://college.example/',description:'Useful guidance',programs:'',admissions:'',financialAid:'',events:'',publicEmail:'',links:[]};
async function setup(){const {pool}=await fixture();const run=createInstitutionRepository(pool,['reviewer']);const call=(sub,data)=>run(sub,validateInstitution(data));const create=async(extra={})=>(await call('owner',{action:'register',registrationKey:crypto.randomUUID(),representative,page,...extra})).institutions[0];const publish=async i=>{await call('owner',{action:'submit',id:i.id,revision:i.revision});await call('reviewer',{action:'verify',id:i.id,revision:i.revision,note:'Confirmed independently'});await call('reviewer',{action:'publish',id:i.id,revision:i.revision,note:'Approved'});};return{pool,run,call,create,publish};}

test('partial drafts resume, unsafe resources cannot submit, and no-op saves preserve revisions',async()=>{
 const {pool,call,create}=await setup();try{
  const i=await create({page:{...page,website:'',description:''}});
  assert.equal(i.revision,1);assert.ok(i.draftSavedAt);
  await assert.rejects(call('owner',{action:'submit',id:i.id,revision:1}),{status:400,message:'draft_incomplete'});
  await call('owner',{action:'save',id:i.id,revision:1,page:i.page});assert.equal((await call('owner',{action:'load'})).institutions[0].revision,1);
  await call('owner',{action:'save',id:i.id,revision:1,page:{...page,links:[{title:'Unsafe',url:'javascript:alert(1)'}]}});
  await assert.rejects(call('owner',{action:'submit',id:i.id,revision:2}),{status:400,message:'draft_incomplete'});
  await call('owner',{action:'save',id:i.id,revision:2,page});await call('owner',{action:'submit',id:i.id,revision:3});
  assert.equal((await call('reviewer',{action:'queue'})).submissions[0].page.description,page.description);
 }finally{await pool.end();}
});

test('review notifications are private, scoped to current membership, and can be marked read',async()=>{
 const {pool,call,create,publish}=await setup();try{
  const i=await create();await publish(i);const owner=await call('owner',{action:'load'});assert.equal(owner.notifications.length,2);assert.equal(owner.institutions[0].publishedPage.name,page.name);
  assert.equal((await call('foreign',{action:'load'})).notifications.length,0);
  await call('foreign',{action:'mark-notification',id:owner.notifications[0].id});assert.equal((await call('owner',{action:'load'})).notifications[0].readAt,null);
  await call('owner',{action:'mark-notification',id:owner.notifications[0].id});assert.ok((await call('owner',{action:'load'})).notifications[0].readAt);
  await pool.query('DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[i.id,'owner']);assert.equal((await call('owner',{action:'load'})).notifications.length,0);
 }finally{await pool.end();}
});

test('only owners can unpublish or archive; restore preserves slug without publishing',async()=>{
 const {pool,run,call,create,publish}=await setup();try{
  const i=await create();await publish(i);
  await pool.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('editor','Sam','sam@college.example','Editor')");
  await pool.query("INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,'editor','editor')",[i.id]);
  await assert.rejects(call('editor',{action:'archive',id:i.id,revision:1}),{status:403});
  await call('owner',{action:'unpublish',id:i.id,revision:1});await assert.rejects(run(null,{action:'public',slug:i.slug}),{status:404});
  await assert.rejects(call('owner',{action:'archive',id:i.id,revision:1}),{status:409});
  await call('owner',{action:'archive',id:i.id,revision:2});await assert.rejects(call('owner',{action:'save',id:i.id,revision:3,page}),{status:409,message:'institution_archived'});
  await call('owner',{action:'restore',id:i.id,revision:3});const restored=(await call('owner',{action:'load'})).institutions[0];assert.equal(restored.slug,i.slug);assert.equal(restored.archivedAt,null);assert.equal(restored.status,'draft');assert.equal(restored.publishedPage,null);assert.equal(restored.publicationHistory.length,3);
  await assert.rejects(run(null,{action:'public',slug:i.slug}),{status:404});
 }finally{await pool.end();}
});

test('a parent cannot disappear while departments have published pages',async()=>{
 const {pool,call,create,publish}=await setup();try{
  const parent=await create();await publish(parent);const child=await create({page:{...page,name:'Outreach'},unitType:'department',parentId:parent.id});await publish(child);
  await assert.rejects(call('owner',{action:'archive',id:parent.id,revision:1}),{status:409,message:'published_departments_exist'});
  await assert.rejects(call('owner',{action:'unpublish',id:parent.id,revision:1}),{status:409,message:'published_departments_exist'});
  await call('owner',{action:'unpublish',id:child.id,revision:1});await call('owner',{action:'archive',id:parent.id,revision:1});
  await call('owner',{action:'submit',id:child.id,revision:2});await assert.rejects(call('reviewer',{action:'publish',id:child.id,revision:2,note:'Review complete'}),{status:409,message:'parent_publication_required'});
 }finally{await pool.end();}
});
