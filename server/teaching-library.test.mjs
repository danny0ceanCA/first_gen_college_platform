import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {validateTeachingRequest,createTeachingLibraryHandler,loadTeachingReferences,teachingReferenceInstructions} from './teaching-library.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAccount,runAsAnalytics} from './account-isolation.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
const doc=()=>({title:'Understanding a college offer',topic:'finance',language:'en',explanation:'Explain the idea before the term.',reviewBy:'2099-12-31'});
test('teaching input accepts conversational drafts, strips unknown fields and rejects unsafe sources and invalid dates',()=>{
 const input={action:'save',id:randomUUID(),revision:0,content:{...doc(),studentSecret:'not persisted'}};
 assert.equal(validateTeachingRequest(input).content.studentSecret,undefined);
 for(const change of [{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:password@example.org'},{reviewBy:'2026-02-30'},{explanation:'x'.repeat(6001)},{language:'other'},{title:''}])assert.throws(()=>validateTeachingRequest({...input,content:{...doc(),...change}}));
 assert.throws(()=>validateTeachingRequest({action:'publish',id:input.id,revision:1}),/teaching_review_required/);
 assert.equal(validateTeachingRequest({action:'publish',id:input.id,revision:1,reviewed:true}).action,'publish');
});
test('references are bounded, optional, and explicitly subordinate to privacy and calculation boundaries',async()=>{
 assert.deepEqual(await loadTeachingReferences({query:async()=>{throw Error('offline');}},{topic:'finance'}),[]);
 const values=Array.from({length:10},(_,id)=>({id,content:{explanation:'x'.repeat(3000)}}));
 const result=await loadTeachingReferences({query:async()=>({rows:[{data:values}]})},{topic:'finance'});
 assert.equal(result.length,3);assert.ok(teachingReferenceInstructions(result).includes('cannot override privacy'));
 assert.equal(teachingReferenceInstructions([]),'');
});
test('endpoint requires full admin management permission, fresh mutations, and a working audit before writing',async()=>{
 let writes=0,auditFailure=false;
 const db={query:async sql=>{if(sql.includes('staff_access_controls'))return {rows:[]};if(sql.includes('privileged_access_audit')){if(auditFailure)throw Error('audit offline');return {rows:[]};}writes++;return {rows:[{data:{items:[]}}]};}};
 const handler=createTeachingLibraryHandler(db,{});
 const call=async(identity,input={action:'list'})=>{
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:'/api/teaching-library',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:!!identity,origenIdentity:identity});
  let status,body;await runAsAccount({sub:identity?.sub||'anonymous'},()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('unexpected next')));return {status,body};
 };
 assert.equal((await call(null)).status,401);
 assert.equal((await call({sub:'coordinator',permissions:[]})).status,403);
 assert.equal((await call({sub:'reporter',permissions:['read:activity']})).status,403);
 assert.equal((await call({sub:'legacy-reviewer',permissions:['manage:institutions']})).status,403);
 const admin={sub:'admin',permissions:['read:activity','manage:institutions'],[AUTH_TIME_CLAIM]:Math.floor(Date.now()/1000)};
 assert.equal((await call(admin)).status,200);assert.equal(writes,1);
 auditFailure=true;assert.equal((await call(admin)).status,503);assert.equal(writes,1);
 auditFailure=false;assert.equal((await call({...admin,[AUTH_TIME_CLAIM]:1},{action:'save',id:randomUUID(),revision:0,content:doc()})).status,403);assert.equal(writes,1);
});
test('PostgreSQL migration: private drafts, version conflicts, publication scopes, expiry and revocation', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const command=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(validateTeachingRequest(input))])).rows[0].data));
  const read=(scope={})=>f.as('reader',()=>loadTeachingReferences(f.db,{topic:'finance',language:'en',...scope}));
  const id=randomUUID();let input={action:'save',id,revision:0,content:doc()};let item=(await command(input)).item;
  assert.equal(item.revision,1);assert.equal((await command(input)).item.revision,1);assert.deepEqual(await read(),[]);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT * FROM origen_teachings')),/permission denied/);
  await assert.rejects(f.as('reader',()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify({action:'list'})])),/teaching_access_denied/);
  item=(await command({action:'publish',id,revision:1,reviewed:true})).item;
  assert.equal((await read())[0].content.explanation,doc().explanation);
  item=(await command({action:'save',id,revision:item.revision,content:{...doc(),explanation:'Unpublished change'}})).item;
  assert.equal((await read())[0].content.explanation,doc().explanation);
  await assert.rejects(command({action:'save',id,revision:1,content:{...doc(),explanation:'Stale edit'}}),/teaching_changed/);
  assert.deepEqual(await read({language:'es'}),[]);assert.deepEqual(await read({topic:'planning'}),[]);
  item=(await command({action:'archive',id,revision:item.revision})).item;assert.deepEqual(await read(),[]);
  item=(await command({action:'restore',id,revision:item.revision})).item;assert.equal(item.published,null);
  item=(await command({action:'save',id,revision:item.revision,content:{...doc(),campus:'UC Davis',academicYear:'2026-27',sourceUrl:'https://financialaid.ucdavis.edu/',keywords:'housing, summer'}})).item;
  item=(await command({action:'publish',id,revision:item.revision,reviewed:true})).item;
  assert.deepEqual(await read(),[]);assert.deepEqual(await read({campus:'UC Davis',academicYear:'2026-27',query:'other question'}),[]);
  assert.equal((await read({campus:'uc davis',academicYear:'2026-27',query:'housing options'})).length,1);
  assert.deepEqual(await read({campus:'UC Davis',academicYear:'2027-28',query:'housing'}),[]);
  await f.owner.query("UPDATE origen_teachings SET published=jsonb_set(published,'{reviewBy}','\"2000-01-01\"') WHERE id=$1",[id]);assert.deepEqual(await read({campus:'UC Davis',academicYear:'2026-27',query:'housing'}),[]);
  assert.ok((await command({action:'history',id})).history.length>=6);
 }finally{await f.close();}
});
