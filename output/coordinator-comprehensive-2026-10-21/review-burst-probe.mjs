import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {coordinatorRegistrationFixture} from '../../server/fixtures/coordinator-registration.mjs';
const url=new URL(process.env.DATABASE_TEST_URL||'');assert.equal(url.hostname,'127.0.0.1');
const f=await coordinatorRegistrationFixture({runtimePoolSize:5,productionTimeouts:true});
const report={syntheticIdentity:true,concurrency:150,pool:5,statuses:{},connectionFailures:[],transactionQueryCounts:[],failedRequestsPersisted:0};
try{
 const ids=Array.from({length:150},()=>randomUUID());
 for(const id of ids){
  await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,status) VALUES($1::uuid,$1::uuid::text,$2,'submitted')",[id,{name:'Synthetic '+id,website:'https://example.org/',description:'Synthetic review test'}]);
  await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,'Synthetic Advisor',$2,'Advisor')",['burst-'+id,id+'@example.test']);
  await f.owner.query("INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,$2,'owner')",[id,'burst-'+id]);
 }
 const connect=f.db.connect.bind(f.db);
 f.db.connect=async()=>{
  const start=performance.now();let client;try{client=await connect();}catch(e){report.connectionFailures.push({message:e.message,code:e.code||null,elapsedMs:Math.round(performance.now()-start)});throw e;}
  let queries=0;return {...client,query:async(...args)=>{queries++;return client.query(...args);},release(){report.transactionQueryCounts.push(queries);client.release();}};
 };
 const input=id=>({action:'verify',id,revision:1,note:'Synthetic independent review'});
 const responses=await Promise.all(ids.map(async id=>{const r=await f.request('reviewer','/api/institutions',input(id));report.statuses[r.status]=(report.statuses[r.status]||0)+1;return {id,...r};}));
 const failed=responses.filter(r=>r.status!==200);assert.ok(failed.every(r=>r.status===503));
 for(const r of failed){const rows=await f.owner.query('SELECT 1 FROM origen_institution_reviews WHERE institution_id=$1',[r.id]);report.failedRequestsPersisted+=rows.rows.length;}
 assert.equal(report.failedRequestsPersisted,0);
 for(const r of failed)await f.call('reviewer','/api/institutions',input(r.id));
 const persisted=await f.owner.query("SELECT count(*)::int n,count(DISTINCT institution_id)::int unique_orgs FROM origen_institution_reviews WHERE action='verify'");
 assert.equal(persisted.rows[0].n,150);assert.equal(persisted.rows[0].unique_orgs,150);
 report.retryRecovery=true;report.retried=failed.length;report.verifiedOrganizations=150;
 report.queryCountRange=[Math.min(...report.transactionQueryCounts),Math.max(...report.transactionQueryCounts)];delete report.transactionQueryCounts;
}finally{await f.close();await writeFile(new URL('./review-burst-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
