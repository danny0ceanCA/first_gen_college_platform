// Disposable local verification only. Synthetic identities; never production.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {coordinatorPilotFixture} from '../../server/fixtures/coordinator-pilot.mjs';
const url=new URL(process.env.DATABASE_TEST_URL||'');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
const report={syntheticIdentity:true,productionModified:false,requests:0,droppedResponses:0,checks:[]};
const f=await coordinatorPilotFixture();
let proxy,drop;
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false,error:e.message});}}
const headers=sub=>({'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':f.transportSecret});
async function send(sub,path,input,expected=200){
 report.requests++;const response=await fetch(base+'/api/'+path,{method:'POST',headers:headers(sub),body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
 const body=await response.json();assert.equal(response.status,expected,`${sub}/${path}/${input.action}: ${JSON.stringify(body)}`);
 assert.equal(response.headers.get('cache-control'),'no-store');
 if(sub==='staff'||sub==='colleague')assert.doesNotMatch(JSON.stringify(body),/FAMILY_CONVERSATION_SENTINEL|FAMILY_DERIVED_SENTINEL|GLOBAL_SUMMARY_SENTINEL|UNPUBLISHED_SENTINEL/);
 return body;
}
const student=(input,sub='other')=>send(sub,'binder-sharing',{studentId:'alex',...input});
const staff=(path,input,sub='staff',status=200)=>send(sub,path,{organizationId:f.org,...input},status);
async function lose(sub,path,input){drop=input.action;await assert.rejects(send(sub,path,input),/fetch failed/);assert.equal(drop,undefined,'Proxy must discard the response after backend completion');}
let base;
try{
 proxy=createServer(async(req,res)=>{
  try{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);
   const response=await fetch(f.base+req.url,{method:'POST',headers:headers(req.headers['x-synthetic-actor']),body:raw});const body=await response.text();
   if(drop===input.action){drop=undefined;assert.equal(response.status,200);report.droppedResponses++;res.destroy();return;}
   res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':response.headers.get('cache-control')||''});res.end(body);
  }catch{res.writeHead(500);res.end('{}');}
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${proxy.address().port}`;
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Synthetic student' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 f.actor('sharing-stress-0');
 await f.family('sharing-stress-0',{action:'save-account',account:{firstName:'Unrelated student',role:'student',email:''}});
 await f.family('sharing-stress-0',{action:'save-student',student:{id:'alex',name:'Unrelated student',stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
 await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[createHash('sha256').update('sharing-stress-0').digest('hex')]);
 const preview=await student({action:'preview',connectionId:connection,topics:['options','costs'],entryIds:f.notes.slice(0,2)});
 const publish={action:'publish',studentId:'alex',previewId:preview.previewId,confirmed:true};
 let publication,grant,binder,feedback;
 await check('Lost publish response + 12 retries creates one publication',async()=>{
  await lose('other','binder-sharing',publish);
  const retries=await Promise.all(Array.from({length:12},()=>student(publish)));publication=retries[0];
  assert.ok(retries.every(x=>x.publicationId===publication.publicationId));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_publications')).rows[0].n,1);
 });
 grant=(await student({action:'status'})).grants[0].id;binder=await staff('coordinator-binders',{action:'read',grantId:grant});
 const create={action:'staff-create',organizationId:f.org,grantId:grant,publicationId:publication.publicationId,topic:'options',kind:'guidance',body:'Synthetic guidance',requestId:randomUUID()};
 await check('Lost guidance response + 12 retries creates one attributed entry',async()=>{
  await lose('staff','coordinator-feedback',create);
  const results=await Promise.all(Array.from({length:12},()=>staff('coordinator-feedback',create)));feedback=results[0];assert.ok(results.every(x=>x.id===feedback.id));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_feedback')).rows[0].n,1);
  await staff('coordinator-feedback',{...create,body:'Changed retry'},'staff',409);
 });
 const reply={action:'student-reply',studentId:'alex',feedbackId:feedback.id,version:1,body:'Explicit synthetic reply',requestId:randomUUID()};
 await check('Lost reply response + 12 retries sends only one reply',async()=>{
  await lose('other','coordinator-feedback',reply);await Promise.all(Array.from({length:12},()=>send('other','coordinator-feedback',reply)));
  assert.equal((await staff('coordinator-feedback',{action:'staff-thread',grantId:grant,feedbackId:feedback.id})).replies.length,1);
  await send('other','coordinator-feedback',{...reply,body:'Changed retry'},409);
 });
 await check('Every coordinator read/write rejects another coordinator and unrelated account',async()=>{
  for(const actor of ['colleague','sharing-stress-0']){
   for(const input of [{action:'read',grantId:grant},{action:'review',grantId:grant,publicationId:publication.publicationId}])await staff('coordinator-binders',input,actor,actor==='colleague'?404:403);
   for(const input of [{action:'staff-list'},{action:'staff-thread',feedbackId:feedback.id},{...create,requestId:randomUUID()},{action:'staff-edit',feedbackId:feedback.id,version:1,kind:'guidance',body:'FORGED',requestId:randomUUID()},{action:'staff-withdraw',feedbackId:feedback.id,version:1,requestId:randomUUID()}]){
    const r=await f.request(actor,'/api/coordinator-feedback',{organizationId:f.org,grantId:grant,...input});report.requests++;
    assert.ok([403,404].includes(r.status),`${actor}/${input.action}: ${r.status}`);assert.doesNotMatch(JSON.stringify(r.body),/Synthetic guidance|Explicit synthetic reply/);
   }
  }
 });
 await check('Student IDs, preview IDs, entry IDs, and grant IDs cannot cross accounts',async()=>{
  for(const input of [{action:'preview',connectionId:connection,topics:['options'],entryIds:[f.notes[0]]},{action:'publish',previewId:preview.previewId,confirmed:true},{action:'revoke',grantId:grant},{action:'withdraw',grantId:grant,itemId:binder.entries[0].id},{action:'remove-topic',grantId:grant,topic:'options'},{action:'help',grantId:grant,requested:true}]){
   const r=await f.request('sharing-stress-0','/api/binder-sharing',{studentId:'alex',...input});report.requests++;assert.ok([403,409].includes(r.status),`${input.action}: ${r.status}`);
  }
  const own=await student({action:'status'},'sharing-stress-0');assert.equal(own.grants.length,0);
  for(const action of ['student-thread','student-reply','student-review','student-hide','student-remove','student-report']){
   const r=await f.request('sharing-stress-0','/api/coordinator-feedback',{action,studentId:'alex',feedbackId:feedback.id,version:1,body:'FORGED',reason:'privacy',requestId:randomUUID()});report.requests++;assert.ok([403,404].includes(r.status),`${action}: ${r.status}`);
  }
  assert.equal((await staff('coordinator-binders',{action:'read',grantId:grant})).entries.length,2);
 });
 await check('Family provenance introduced after preview blocks publishing and erases existing copy',async()=>{
  const p=await student({action:'preview',connectionId:connection,topics:['options','costs'],entryIds:f.notes.slice(0,2)});
  await f.owner.query("UPDATE origen_binder_source_lineage SET classification='family',revision=revision+1 WHERE source_id=$1",[f.notes[0]]);
  await send('other','binder-sharing',{action:'publish',studentId:'alex',previewId:p.previewId,confirmed:true},409);
  const r=await staff('coordinator-binders',{action:'read',grantId:grant});assert.equal(r.entries.length,1);assert.equal(r.entries[0].topic,'costs');
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE topic='options' AND content<>''")).rows[0].n,0);
 });
 await check('Lost stop-sharing response + retries leaves no staff access or retained publication content',async()=>{
  const revoke={action:'revoke',studentId:'alex',grantId:grant};await lose('other','binder-sharing',revoke);await Promise.all(Array.from({length:12},()=>student(revoke)));
  await staff('coordinator-binders',{action:'read',grantId:grant},'staff',404);
  await staff('coordinator-feedback',{action:'staff-thread',grantId:grant,feedbackId:feedback.id},'staff',404);
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  await send('other','binder-sharing',publish,409);
  const copy=await send('other','coordinator-feedback',{action:'student-list',studentId:'alex'});assert.equal(copy.feedback[0].connectionEnded,true);
 });
}catch(e){report.checks.push({name:'setup',passed:false,error:e.stack});}
finally{if(proxy)await new Promise(r=>{proxy.close(r);proxy.closeAllConnections();});await f.close();report.passed=report.checks.every(c=>c.passed);await writeFile(new URL('./boundary-fault-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
