import {createHash,randomUUID} from 'node:crypto';
import {buildInstitutionReport,institutionFilters} from './admin-institutions.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function snapshotFilters(input){
 if(!input||!['institution-snapshot-save','institution-snapshots','institution-snapshot'].includes(input.action))throw fail(400,'invalid_snapshot');
 const allowed=input.action==='institution-snapshot-save'?['action','page','search','status','requestKey']:input.action==='institution-snapshot'?['action','id']:['action','page'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw fail(400,'invalid_snapshot');
 if(input.action==='institution-snapshot-save'){
  if(!uuid(input.requestKey))throw fail(400,'invalid_snapshot');
  return {...institutionFilters(input),requestKey:input.requestKey,action:input.action};
 }
 if(input.action==='institution-snapshot'){if(!uuid(input.id))throw fail(400,'invalid_snapshot');return input;}
 if(!Number.isInteger(input.page??1)||(input.page??1)<1||(input.page??1)>10000)throw fail(400,'invalid_snapshot');
 return {action:input.action,page:input.page??1};
}
export async function adminReportSnapshots(database,subject,input,now=new Date()){
 const f=snapshotFilters(input),c=await database.connect(),cutoff=new Date(+now-90*86400000);
 try{
  // Snapshot writes serialize before reading. Source reads share a consistent snapshot.
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  if(f.action==='institution-snapshot-save'){
   // Acquire before the first MVCC read so concurrent saves see the preceding commit.
   await c.query('LOCK TABLE origen_institution_report_snapshots IN SHARE ROW EXCLUSIVE MODE');
   await guardAccountTransaction(c,subject);
   const hash=createHash('sha256').update(JSON.stringify([subject,f.page,f.search,f.status])).digest('hex');
   const prior=(await c.query('SELECT id,request_hash,created_at FROM origen_institution_report_snapshots WHERE request_key=$1',[f.requestKey])).rows[0];
   if(prior){if(prior.request_hash!==hash)throw fail(409,'snapshot_request_changed');if(new Date(prior.created_at)<cutoff)throw fail(410,'snapshot_expired');await c.query('COMMIT');return {saved:true,id:prior.id,replayed:true};}
   const {count}= (await c.query('SELECT count(*) AS count FROM origen_institution_report_snapshots WHERE created_at>=$1',[cutoff])).rows[0];
   if(Number(count)>=500)throw fail(409,'snapshot_limit_reached');
   const report=await buildInstitutionReport(c,{page:f.page,search:f.search,status:f.status},now);
   const id=randomUUID(),payload={...report,snapshot:{id,savedAt:now.toISOString(),expiresAt:new Date(+now+90*86400000).toISOString(),scope:'Current filtered directory page, at most 25 institution rows. Historical values; not a live research release.'}};
   await c.query('INSERT INTO origen_institution_report_snapshots(id,request_key,request_hash,created_at,month,payload) VALUES($1,$2,$3,$4,$5,$6)',[id,f.requestKey,hash,now,report.month,JSON.stringify(payload)]);
   await c.query('COMMIT');return {saved:true,id,replayed:false};
  }
  if(f.action==='institution-snapshot'){
   const row=(await c.query('SELECT payload FROM origen_institution_report_snapshots WHERE id=$1 AND created_at>=$2',[f.id,cutoff])).rows[0];
   if(!row)throw fail(404,'snapshot_unavailable');
   await c.query('COMMIT');return row.payload;
  }
  const total=Number((await c.query('SELECT count(*) AS count FROM origen_institution_report_snapshots WHERE created_at>=$1',[cutoff])).rows[0].count);
  const rows=(await c.query("SELECT id,created_at,month,payload->'filters' AS filters,jsonb_array_length(payload->'institutions') AS rows FROM origen_institution_report_snapshots WHERE created_at>=$1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2",[cutoff,(f.page-1)*20])).rows;
  await c.query('COMMIT');return {items:rows,total,page:f.page,pageSize:20,retentionDays:90};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function purgeAdminReportSnapshots(database){if(database)await database.query("DELETE FROM origen_institution_report_snapshots WHERE created_at < now()-interval '90 days'");}
