import {runAsAccount,isolateDatabase} from './account-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {migrateDatabase} from './database.mjs';
import {createAdminHandler} from './admin.mjs';
import {adminProgress,progressFilters} from './admin-progress.mjs';
import {adminInstitutionReport} from './admin-institutions.mjs';
import {adminReportSnapshots,snapshotFilters,purgeAdminReportSnapshots} from './admin-report-snapshots.mjs';
import {createProgressRepository,validateProgress,purgeProgressHistory} from './progress-history.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
const now=new Date('2026-10-10T20:00:00Z');
test('progress and snapshot requests reject arbitrary cohorts, payloads, free text and date filters',()=>{
 for(const input of [{days:1},{days:'30'},{institutionId:uuid()},{search:'student'},{language:'es'},{asOf:'2026-10-10'}])assert.throws(()=>progressFilters(input),{status:400});
 assert.deepEqual(progressFilters({days:7}),{days:7});
 for(const input of [{action:'institution-snapshot',id:'bad'},{action:'institution-snapshots',page:0},{action:'institution-snapshot-save',requestKey:uuid(),payload:{}},{action:'institution-snapshot-save',requestKey:uuid(),month:'2026-01'}])assert.throws(()=>snapshotFilters(input),{status:400});
 const prompt={action:'prompt-opened',id:uuid(),studentId:'one',language:'es'};assert.deepEqual(validateProgress(prompt),prompt);
 for(const change of [{id:7},{name:'Private'},{occurredDate:'2026-10-10'},{language:'fr'},{studentId:undefined}])assert.throws(()=>validateProgress({...prompt,...change}),{status:400});
 assert.throws(()=>validateProgress({action:'record',id:uuid(),studentId:'one',language:'en',kind:'milestone',value:'application-submitted',responseStatus:'answered',promptId:uuid()}),{status:400});
});
test('all new reporting actions require current admin access and hide server failures',async()=>{
 for(const action of ['progress-report','institution-snapshot-save','institution-snapshots','institution-snapshot','institution-report']){
  let status,body;const res={writeHead:s=>status=s,end:s=>{body=JSON.parse(s);}};
  const req=(permissions=[],method='POST')=>({url:'/api/admin',method,origenAuthorized:true,origenIdentity:{sub:'test',permissions},async *[Symbol.asyncIterator](){yield JSON.stringify({action});}});
  await createAdminHandler({connect:()=>assert.fail()},{})(req(),res,()=>{});assert.equal(status,403);
  await createAdminHandler({connect:()=>assert.fail()},{})(req(['read:activity'],'GET'),res,()=>{});assert.equal(status,405);
  if(['progress-report','institution-report','institution-snapshots'].includes(action)){
   await createAdminHandler({connect:()=>{throw Error('PRIVATE credentials');}},{})(req(['read:activity']),res,()=>{});assert.equal(status,503);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
  }
 }
});
const enabled=!!(process.env.ADMIN_TEST_PGLITE_MODULE||process.env.DATABASE_TEST_URL);
test('PostgreSQL phase 6 migrations, measurement denominators, private deletion, suppression and immutable snapshots',{skip:!enabled},async()=>{
 let db,close,pglite=false;
 if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);db=new PGlite();close=()=>db.close();pglite=true;}
 else{const {Client}=await import('pg');db=new Client({connectionString:process.env.DATABASE_TEST_URL});await db.connect();close=()=>db.end();}
 const schema='progress_'+uuid().replaceAll('-','');
 const query=async(sql,args)=>pglite&&!args?(await db.exec(sql)).at(-1):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 try{
  await query(`CREATE SCHEMA ${schema}`);await query(`SET search_path TO ${schema}`);await query("SET TIME ZONE 'UTC'");await migrateDatabase(pool);await migrateDatabase(pool);
  const owner=uuid(),other=uuid();await query("INSERT INTO origen_accounts(id,auth0_subject,first_name) VALUES($1,'owner','PRIVATE name'),($2,'other','PRIVATE other')",[owner,other]);
  await query("INSERT INTO origen_students(account_id,id,name) VALUES($1,'one','PRIVATE child'),($1,'two','PRIVATE sibling'),($2,'one','PRIVATE other child')",[owner,other]);
  const run=createProgressRepository(pool),p={action:'prompt-opened',id:uuid(),studentId:'one',language:'en'};
  await run('owner',validateProgress(p));await run('owner',validateProgress(p));
  assert.equal(Number((await query('SELECT count(*) AS n FROM origen_feedback_prompts')).rows[0].n),1);
  await assert.rejects(run('owner',validateProgress({...p,studentId:'two'})),{status:409});
  const feedback={action:'record',id:uuid(),studentId:'one',kind:'feedback',responseStatus:'answered',value:'helpful',language:'es',promptId:p.id};
  await assert.rejects(run('other',validateProgress(feedback)),{status:404});
  await assert.rejects(run('owner',validateProgress({...feedback,studentId:'two'})),{status:404});
  await run('owner',validateProgress(feedback));await run('owner',validateProgress(feedback));
  await assert.rejects(run('owner',validateProgress({...feedback,id:uuid()})),{status:409});
  await assert.rejects(run('owner',validateProgress({...feedback,promptId:undefined})),{status:409});
  const add=async(kind,value,extra={})=>run('owner',validateProgress({action:'record',id:uuid(),studentId:'one',kind,responseStatus:value===null?'declined':'answered',value,language:'en',...extra}));
  await add('feedback','partly');await add('feedback','not-yet');await add('feedback',null);await add('feedback',null,{responseStatus:'unknown'});
  const decline=uuid(),noanswer=uuid();for(const id of [decline,noanswer])await run('owner',validateProgress({...p,id}));
  await add('feedback',null,{promptId:decline});
  await add('milestone','application-submitted',{occurredDate:'2026-08-01'});await add('milestone','application-submitted');await add('milestone','counselor-contacted');
  await query("UPDATE origen_feedback_prompts SET recorded_at='2026-10-08T12:00Z'");await query("UPDATE origen_progress_reports SET recorded_at='2026-10-08T12:01Z'");
  let report=await adminProgress(pool,{days:7},now,{PROGRESS_HISTORY_ENABLED:'true'});
  assert.deepEqual(report.feedback.helpfulness,{numerator:1,denominator:3,percent:33.3});
  assert.deepEqual(report.feedback.participation,{numerator:1,denominator:3,percent:33.3});
  assert.equal(report.feedback.unlinked,4);assert.equal(report.feedback.declinedPrompts,1);assert.equal(report.feedback.withoutAnswer,1);
  assert.equal(report.milestoneAccounts,1);assert.equal(report.milestones.find(x=>x.value==='application-submitted').submissions,2);assert.equal(report.milestones.find(x=>x.value==='application-submitted').accounts,1);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE|student_id|auth0_subject|"transcript"|summary_id/);
  await query("UPDATE origen_feedback_prompts SET recorded_at='2026-09-01' WHERE id=$1",[p.id]);
  report=await adminProgress(pool,{days:7},now);assert.deepEqual(report.feedback.participation,{numerator:0,denominator:2,percent:0});assert.equal(report.feedback.helpfulness.numerator,1);
  const empty=await adminProgress(pool,{days:7},new Date('2026-08-01'));assert.equal(empty.feedback.helpfulness.percent,null);assert.equal(empty.feedback.participation.percent,null);assert.equal(empty.collectionEnabled,false);
  const exported=await runAsAccount({sub:'owner'},()=>createLifecycleRepository(isolateDatabase(pool,{schema}))('owner',{action:'export'}));assert.equal(exported.feedbackPrompts.length,3);
  // Institution reports read only institution operational facts, with a fixed closed month.
  const a=uuid(),b=uuid();await query("INSERT INTO origen_institutions(id,slug,draft,status,verification_status) VALUES($1,'college-a','{\"name\":\"College A\"}','published','verified'),($2,'unit-b','{\"name\":\"Unit B\"}','published','verified')",[a,b]);
  await query("UPDATE origen_institutions SET parent_institution_id=$1,unit_type='department' WHERE id=$2",[a,b]);
  await query("INSERT INTO origen_institution_metrics(institution_id,month,metric,count) VALUES($1,'2026-09','page_view',12),($1,'2026-09','link_click',9),($2,'2026-09','page_view',9),($2,'2026-09','link_click',10)",[a,b]);
  await query("UPDATE origen_institution_outreach_collection SET started_at='2026-09-01'");
  await query("INSERT INTO origen_institution_outreach_facts(institution_id,kind,submitted_at,first_response_at) SELECT $1,'inquiry','2026-09-02T12:00Z','2026-09-02T14:00Z' FROM generate_series(1,10)",[a]);
  await query("INSERT INTO origen_institution_outreach_facts(institution_id,parent_id,kind,submitted_at,first_response_at) SELECT $1,$2,'inquiry','2026-09-02T12:00Z','2026-09-02T18:00Z' FROM generate_series(1,9)",[b,a]);
  await query("INSERT INTO origen_institution_outreach_facts(institution_id,kind,submitted_at,first_response_at) VALUES($1,'rsvp','2026-09-10','2026-10-01')",[b]);
  let institution=await adminInstitutionReport(pool,{},now);let first=institution.institutions.find(x=>x.id===a),second=institution.institutions.find(x=>x.id===b);
  assert.equal(Number(first.inquiries),10);assert.equal(Number(first.first_response_hours),2);assert.equal(first.link_clicks,null);assert.equal(second.inquiries,null);assert.equal(second.rsvps,null);assert.equal(second.first_response_hours,null);assert.equal(Number(second.link_clicks),10);
  assert.equal(institution.outreach.coverage,'availability-not-verified');
  await query("UPDATE origen_institution_outreach_collection SET started_at='2026-09-15'");assert.equal((await adminInstitutionReport(pool,{},now)).outreach.coverage,'partial-month');
  await query("UPDATE origen_institution_outreach_collection SET started_at='2026-10-01'");assert.equal((await adminInstitutionReport(pool,{},now)).institutions.find(x=>x.id===a).inquiries,null);
  await query("UPDATE origen_institution_outreach_collection SET started_at='2026-09-01'");
  const request={action:'institution-snapshot-save',requestKey:uuid(),page:1,search:'',status:'all'};
  const saved=await adminReportSnapshots(pool,'admin',request,now),replay=await adminReportSnapshots(pool,'admin',request,now);assert.equal(saved.id,replay.id);assert.equal(replay.replayed,true);
  await assert.rejects(adminReportSnapshots(pool,'admin',{...request,search:'College'},now),{status:409});
  await query("UPDATE origen_institution_metrics SET count=30 WHERE institution_id=$1 AND metric='page_view'",[a]);
  const snapshot=await adminReportSnapshots(pool,'admin',{action:'institution-snapshot',id:saved.id},now);
  assert.equal(Number(snapshot.institutions.find(x=>x.id===a).page_views),12);assert.equal(Number((await adminInstitutionReport(pool,{},now)).institutions.find(x=>x.id===a).page_views),30);
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE|auth0_subject|request_hash|helpfulness|student_id/);assert.equal(snapshot.institutions.find(x=>x.id===b).inquiries,null);
  assert.equal((await adminReportSnapshots(pool,'admin',{action:'institution-snapshots'},now)).total,1);
  await query("INSERT INTO origen_institution_report_snapshots(id,request_key,request_hash,month,payload,created_at) SELECT gen_random_uuid(),gen_random_uuid(),'test',month,payload,created_at FROM origen_institution_report_snapshots CROSS JOIN generate_series(1,21)");
  const page1=await adminReportSnapshots(pool,'admin',{action:'institution-snapshots'},now),page2=await adminReportSnapshots(pool,'admin',{action:'institution-snapshots',page:2},now);assert.equal(page1.items.length,20);assert.equal(page2.items.length,2);assert.equal(new Set([...page1.items,...page2.items].map(x=>x.id)).size,22);
  await query("INSERT INTO origen_institution_report_snapshots(id,request_key,request_hash,month,payload,created_at) SELECT gen_random_uuid(),gen_random_uuid(),'test',month,payload,created_at FROM origen_institution_report_snapshots CROSS JOIN generate_series(1,478) WHERE id=$1",[saved.id]);
  await assert.rejects(adminReportSnapshots(pool,'admin',{...request,requestKey:uuid()},now),{status:409,message:'snapshot_limit_reached'});
  await assert.rejects(adminReportSnapshots(pool,'admin',request,new Date('2027-02-01')),{status:410});
  await assert.rejects(adminReportSnapshots(pool,'admin',{action:'institution-snapshot',id:saved.id},new Date('2027-02-01')),{status:404});
  await createLifecycleRepository(pool)('owner',{action:'delete',confirmation:'DELETE'});
  assert.equal(Number((await query('SELECT count(*) AS n FROM origen_feedback_prompts')).rows[0].n),0);assert.equal((await adminProgress(pool,{},now)).feedback.submissions,0);
  await query("UPDATE origen_institution_report_snapshots SET created_at='2000-01-01'");await purgeAdminReportSnapshots(pool);assert.equal((await adminReportSnapshots(pool,'admin',{action:'institution-snapshots'},now)).total,0);
  await run('other',validateProgress({...p,id:uuid()}));await query("UPDATE origen_feedback_prompts SET recorded_at='2000-01-01'");await purgeProgressHistory(pool);assert.equal(Number((await query('SELECT count(*) AS n FROM origen_feedback_prompts')).rows[0].n),0);
 }finally{await query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});await close();}
});
