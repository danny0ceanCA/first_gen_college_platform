// Local-only load and race testing. No production identities, tokens or content.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {coordinatorPilotFixture} from '../server/fixtures/coordinator-pilot.mjs';
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const users=Number(opt('--users','24')),concurrency=Number(opt('--concurrency','40')),pool=Number(opt('--pool','10')),rounds=Number(opt('--rounds','4')),seed=Number(opt('--seed','0')),output=opt('--output','');
const url=new URL(process.env.DATABASE_TEST_URL||'https://invalid');
if(!args.includes('--disposable-database')||!output||!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||![users,concurrency,pool,rounds,seed].every(Number.isInteger)||users<2||users>100||concurrency<2||concurrency>150||pool<2||pool>30||rounds<1||rounds>20||seed<0||seed>0xffffffff)throw Error('Explicit disposable loopback database required; users 2-100, concurrency 2-150, pool 2-30, rounds 1-20, seed 0-4294967295.');
await mkdir(output,{recursive:false});
const report={startedAt:new Date().toISOString(),users,concurrency,pool,rounds,seed,syntheticIdentity:true,scenarios:[],assertionFailures:[],requests:0,peak:0},f=await coordinatorPilotFixture({runtimePoolSize:pool,productionTimeouts:true});
let randomState=seed;const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return (randomState>>>0)/4294967296;};
let active=0,current;const students=[];
async function send(sub,path,input,allowed=[200]){
 const start=performance.now();active++;report.peak=Math.max(report.peak,active);let status='transport',error;
 try{
  const response=await fetch(f.base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':f.transportSecret},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
  status=response.status;const body=await response.json();error=body.error;
  assert.ok(allowed.includes(status),`${path}/${input.action}: ${status} ${error||''}`);
  if(sub==='staff'||sub==='colleague')assert.doesNotMatch(JSON.stringify(body),/PRIVATE_STRESS_|FAMILY_CONVERSATION_SENTINEL|FAMILY_DERIVED_SENTINEL|GLOBAL_SUMMARY_SENTINEL|UNPUBLISHED_SENTINEL/);
  return body;
 }finally{
  active--;report.requests++;if(current){current.timings.push(performance.now()-start);const key=`${status}${error?':'+error:''}`;current.statuses[key]=(current.statuses[key]||0)+1;}
 }
}
const student=(u,path,input,allowed)=>send(u.sub,path,{studentId:'alex',...input},allowed);
const staff=(path,input,allowed,actor='staff')=>send(actor,path,{organizationId:f.org,...input},allowed);
async function batch(tasks){tasks=[...tasks];if(seed)for(let i=tasks.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[tasks[i],tasks[j]]=[tasks[j],tasks[i]];}let index=0;const failures=[];await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{while(index<tasks.length){const task=tasks[index++];try{await task();}catch(e){failures.push(e.message);}}}));if(failures.length){report.assertionFailures.push({scenario:current.name,count:failures.length,samples:[...new Set(failures)].slice(0,12)});}}
async function scenario(name,work){current={name,timings:[],statuses:{}};const before=report.assertionFailures.length,start=performance.now();try{await work();}catch(e){report.assertionFailures.push({scenario:name,count:1,samples:[e.message]});}finally{const times=current.timings.sort((a,b)=>a-b);const result={name,requests:times.length,statuses:current.statuses,p95Ms:Math.round(times[Math.floor(times.length*.95)]||0),maxMs:Math.round(times.at(-1)||0),durationMs:Math.round(performance.now()-start),passed:before===report.assertionFailures.length};report.scenarios.push(result);console.log(JSON.stringify(result));current=undefined;}}
async function publish(u){const p=await student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options','costs'],entryIds:u.notes});const result=await student(u,'binder-sharing',{action:'publish',previewId:p.previewId,confirmed:true});u.pub=result.publicationId;u.preview=p.previewId;return result;}
async function republishAll(){for(const u of students)await publish(u);}
try{
 await scenario('seed independent synthetic student accounts and private sentinels',async()=>{
  for(let i=0;i<users;i++){
   const u={sub:`sharing-stress-${i}`,connection:randomUUID(),notes:[randomUUID(),randomUUID()],version:1};f.actor(u.sub);
   await f.family(u.sub,{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
   await f.family(u.sub,{action:'save-student',student:{id:'alex',name:'Synthetic '+i,stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
   u.account=(await f.owner.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[u.sub])).rows[0].id;
   await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[createHash('sha256').update(u.sub).digest('hex')]);
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),$4 FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[u.connection,u.account,randomUUID(),'Synthetic '+i,f.org]);
   for(let j=0;j<2;j++)await f.note({action:'create',studentId:'alex',id:u.notes[j],note:{topic:j?'costs':'options',kind:'note',content:`Public synthetic note ${i}/${j}`,language:'en'}},u.sub);
   u.privateNote=randomUUID();await f.note({action:'create',studentId:null,id:u.privateNote,note:{topic:'options',kind:'note',content:'PRIVATE_STRESS_FAMILY',language:'en'}},u.sub);
   await f.save('private-summary','PRIVATE_STRESS_CONVERSATION',{studentId:'alex',sub:u.sub});
   await publish(u);u.grant=(await student(u,'binder-sharing',{action:'status'})).grants[0].id;students.push(u);
  }
  assert.equal(students.length,users);
 });
 if(students.length!==users)throw Error('incomplete synthetic setup');
 await scenario('concurrent reads, private-content boundaries and foreign grants',async()=>{
  await batch(students.flatMap((u,i)=>Array.from({length:rounds},()=>[
   async()=>{const r=await staff('coordinator-binders',{action:'read',grantId:u.grant});assert.equal(r.entries.length,2);},
   ()=>student(u,'binder-sharing',{action:'status'}),
   ()=>staff('coordinator-binders',{action:'read',grantId:u.grant},[404],'colleague'),
   ()=>student(u,'binder-sharing',{action:'revoke',grantId:students[(i+1)%users].grant},[403]),
   ()=>student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options'],entryIds:[u.privateNote]},[409]),
   ()=>student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options'],entryIds:[students[(i+1)%users].notes[0]]},[409]),
  ]).flat()));
 });
 await scenario('publication retry storms create exactly one version per preview',async()=>{
  const before=(await f.owner.query('SELECT count(*)::int n FROM origen_binder_publications')).rows[0].n;
  for(const u of students)u.preview=(await student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options','costs'],entryIds:u.notes})).previewId;
  await batch(students.flatMap(u=>Array.from({length:rounds*2},()=>async()=>{const r=await student(u,'binder-sharing',{action:'publish',previewId:u.preview,confirmed:true});u.pub=r.publicationId;})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_publications')).rows[0].n-before,users);
 });
 await scenario('publication versus revocation never restores a stale preview',async()=>{
  for(let round=0;round<rounds;round++){
   await republishAll();for(const u of students)u.preview=(await student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options','costs'],entryIds:u.notes})).previewId;
   await batch(students.flatMap(u=>[
    ()=>student(u,'binder-sharing',{action:'publish',previewId:u.preview,confirmed:true},[200,409]),
    ()=>student(u,'binder-sharing',{action:'revoke',grantId:u.grant}),
    ...Array.from({length:2},()=>()=>staff('coordinator-binders',{action:'read',grantId:u.grant},[200,404])),
   ]));
   await batch(students.map(u=>()=>staff('coordinator-binders',{action:'read',grantId:u.grant},[404])));
   assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  }
 });
 await scenario('coordinator guidance writes compete with student publication and replies',async()=>{
  await republishAll();
  for(const u of students){u.feedback=(await staff('coordinator-feedback',{action:'staff-create',grantId:u.grant,publicationId:u.pub,topic:'options',kind:'guidance',body:'Synthetic topic guidance',requestId:randomUUID()})).id;}
  for(let round=0;round<rounds;round++){
   await batch(students.flatMap(u=>[
    ()=>publish(u),
    ()=>staff('coordinator-feedback',{action:'staff-edit',grantId:u.grant,feedbackId:u.feedback,version:round+1,kind:'guidance',body:'Synthetic revision '+round,requestId:randomUUID()}),
    ()=>student(u,'coordinator-feedback',{action:'student-reply',feedbackId:u.feedback,version:round+1,body:'Synthetic reply',requestId:randomUUID()},[200,409]),
    ()=>staff('coordinator-feedback',{action:'staff-list',grantId:u.grant}),
   ]));
  }
 });
 await scenario('source edits compete with publication and immediately retire obsolete copies',async()=>{
  for(let round=0;round<rounds;round++){
   await republishAll();for(const u of students)u.preview=(await student(u,'binder-sharing',{action:'preview',connectionId:u.connection,topics:['options','costs'],entryIds:u.notes})).previewId;
   await batch(students.flatMap(u=>[
    async()=>{await f.note({action:'update',studentId:'alex',id:u.notes[0],version:u.version,note:{topic:'options',kind:'note',content:`New synthetic version ${u.version+1}`,language:'en'}},u.sub);u.version++;},
    ()=>student(u,'binder-sharing',{action:'publish',previewId:u.preview,confirmed:true},[200,409]),
    ()=>staff('coordinator-binders',{action:'read',grantId:u.grant}),
   ]));
   await batch(students.map(u=>async()=>{const r=await staff('coordinator-binders',{action:'read',grantId:u.grant});assert.equal(r.entries.filter(e=>e.topic==='options').length,0);}));
  }
 });
 await scenario('maintenance, help requests, reviews and notifications under publication churn',async()=>{
  await republishAll();
  await batch(students.flatMap(u=>Array.from({length:rounds},()=>[
   ()=>student(u,'binder-sharing',{action:'help',grantId:u.grant,requested:true}),
   ()=>staff('coordinator-binders',{action:'review',grantId:u.grant,publicationId:u.pub}),
   ()=>staff('coordinator-notifications',{action:'list',audience:'staff'}),
   ()=>student(u,'coordinator-feedback',{action:'student-list'}),
  ]).flat()).concat(Array.from({length:rounds},()=>()=>f.sweep())));
 });
 await scenario('organization suspension versus publication, reads and feedback',async()=>{
  await republishAll();
  const work=students.flatMap(u=>[
   ()=>publish(u).catch(e=>{if(!/403|409/.test(e.message))throw e;}),
   ()=>staff('coordinator-binders',{action:'read',grantId:u.grant},[200,403,404]),
   ()=>student(u,'coordinator-feedback',{action:'student-reply',feedbackId:u.feedback,version:rounds+1,body:'Synthetic final reply',requestId:randomUUID()},[200,403,409]),
  ]);
  work.splice(Math.floor(work.length/3),0,()=>staff('coordinator-access',{action:'suspend-organization',id:f.org} ,[200],'reviewer'));
  await batch(work);
  await batch(students.map(u=>()=>staff('coordinator-binders',{action:'read',grantId:u.grant},[403])));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_share_grants WHERE status='active'")).rows[0].n,0);
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
 });
}catch(e){report.assertionFailures.push({scenario:'runner',count:1,samples:[e.message]});}
finally{
 report.finishedAt=new Date().toISOString();report.passed=report.assertionFailures.length===0;
 await writeFile(output+'/report.json',JSON.stringify(report,null,2));await f.close();
 console.log(JSON.stringify({passed:report.passed,requests:report.requests,peak:report.peak,failures:report.assertionFailures}));
 if(!report.passed)process.exitCode=1;
}
