import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {newDb,DataType} from 'pg-mem';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=reason=>{throw Object.assign(new Error(reason),{code:reason});};
const text=(value,max=300)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const id=value=>typeof value==='string'&&/^synthetic-[a-z0-9-]{1,70}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateProtocol(p){
 if(!p||p.synthetic!==true||p.approval!=='synthetic-simulation'||!id(p.studyId)||!Number.isSafeInteger(p.version)||p.version<1||!text(p.question)||!text(p.population)||!text(p.notice?.en,5000)||!text(p.notice?.es,5000)||!text(p.withdrawal,2000)||!text(p.reviewReference)||p.adultSelfOnly!==true||p.modelTraining!==false||JSON.stringify(p.fields)!=='["helpfulness"]'||JSON.stringify(p.permittedUses)!=='["aggregate-research"]'||p.instrument!=='guidance-helpfulness-v1'||!Number.isSafeInteger(p.minCellSize)||p.minCellSize<10||!Number.isSafeInteger(p.retentionDays)||p.retentionDays<1||p.retentionDays>90||!Array.isArray(p.recipients)||!p.recipients.length||p.recipients.length>10||p.recipients.some(r=>!id(r))||new Set(p.recipients).size!==p.recipients.length||!/^\d{4}-\d{2}$/.test(p.window?.fromMonth)||!/^\d{4}-\d{2}$/.test(p.window?.toMonth)||p.window.fromMonth>p.window.toMonth)denied('invalid_synthetic_protocol');
 for(const month of [p.window.fromMonth,p.window.toMonth])if(Number(month.slice(5))<1||Number(month.slice(5))>12)denied('invalid_synthetic_protocol');
 return structuredClone(p);
}
// Self-contained synthetic database. No DATABASE_URL, API connector, or production repository is accepted.
export async function createResearchSandbox({now=()=>new Date()}={}){
 const db=newDb();db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:randomUUID});
 db.public.none(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const {Pool}=db.adapters.createPg();const pool=new Pool();let tail=Promise.resolve();
 const audit=async(study,version,actor,action,outcome,reason=null,manifest=null)=>{await pool.query('INSERT INTO lab_access_audit(study_id,version,actor,action,outcome,reason,manifest_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(study)?study:'synthetic-invalid-study',Number.isSafeInteger(version)?version:0,id(actor)?actor:'synthetic-invalid-actor',action,outcome,reason,manifest]);};
 // pg-mem is not a PostgreSQL concurrency/rollback test. Serialize lab operations and restore on failure.
 const serial=(context,job)=>{const run=tail.then(async()=>{const backup=db.backup();try{const result=await job();await audit(...context,'allowed');return result;}catch(error){backup.restore();await audit(...context,'denied',error.code||'operation_failed');throw error;}});tail=run.catch(()=>{});return run;};
 const study=async(studyId,version,active=true)=>{
  const row=(await pool.query('SELECT * FROM lab_study_versions WHERE study_id=$1 AND version=$2',[studyId,version])).rows[0];
  if(!row)denied('study_not_found');if(active&&row.status!=='active-simulation')denied('study_suspended');return row;
 };
 const recipient=async(studyId,version,actor)=>{const r=(await pool.query('SELECT * FROM lab_recipients WHERE study_id=$1 AND version=$2 AND recipient_id=$3',[studyId,version,actor])).rows[0];if(!r||r.revoked)denied('recipient_not_authorized');};
 const mapped=async(studyId,version,subject)=>{if(!id(subject))denied('synthetic_identity_required');return (await pool.query('SELECT participant_id FROM lab_identity_map WHERE study_id=$1 AND version=$2 AND synthetic_subject=$3',[studyId,version,subject])).rows[0]?.participant_id;};
 const invalidate=async(studyId,version,participantId)=>{
  const manifests=(await pool.query('SELECT manifest_id FROM lab_manifest_members WHERE study_id=$1 AND version=$2 AND participant_id=$3',[studyId,version,participantId])).rows;
  for(const m of manifests)await pool.query("UPDATE lab_manifests SET status='invalidated' WHERE id=$1",[m.manifest_id]);
  return manifests.map(m=>m.manifest_id);
 };
 return {
  register(protocol){return serial([protocol?.studyId||'synthetic-invalid',protocol?.version||0,'synthetic-operator','register'],async()=>{
   const p=validateProtocol(protocol);if((await pool.query('SELECT study_id FROM lab_study_versions WHERE study_id=$1 AND version=$2',[p.studyId,p.version])).rows.length)denied('protocol_version_immutable');
   const priorVersions=(await pool.query('SELECT version FROM lab_study_versions WHERE study_id=$1',[p.studyId])).rows;
   if(priorVersions.some(row=>row.version>=p.version))denied('protocol_version_must_increase');
   // A new governing notice invalidates older releases; permissions never carry forward.
   await pool.query("UPDATE lab_study_versions SET status='suspended' WHERE study_id=$1",[p.studyId]);
   await pool.query("UPDATE lab_manifests SET status='invalidated' WHERE study_id=$1",[p.studyId]);
   const protocolHash=hash(p),noticeHash=hash(p.notice);
   await pool.query("INSERT INTO lab_study_versions(study_id,version,protocol,protocol_hash,notice_hash,status) VALUES($1,$2,$3,$4,$5,'active-simulation')",[p.studyId,p.version,JSON.stringify(p),protocolHash,noticeHash]);
   for(const r of p.recipients)await pool.query("INSERT INTO lab_recipients(study_id,version,recipient_id,purpose) VALUES($1,$2,$3,'aggregate-research')",[p.studyId,p.version,r]);
   return {protocolHash,noticeHash,synthetic:true};
  });},
  permission({studyId,version,subject,eventId,action,language,noticeHash,adultSelfConfirmed=false,multiPerson=false}){return serial([studyId,version,subject,'permission'],async()=>{
   if(!id(subject)||!uuid(eventId)||!['consent','decline','withdraw'].includes(action)||!['en','es'].includes(language))denied('invalid_permission');
   const s=await study(studyId,version,action==='consent');
   if(noticeHash!==s.notice_hash)denied('notice_version_mismatch');
   if(action==='consent'&&(!adultSelfConfirmed||multiPerson))denied('adult_self_only');
   let participantId=await mapped(studyId,version,subject);
   const prior=(await pool.query('SELECT * FROM lab_permissions WHERE id=$1',[eventId])).rows[0];
   if(prior){if(prior.study_id!==studyId||prior.version!==version||prior.participant_id!==participantId||prior.action!==action||prior.language!==language||prior.notice_hash!==noticeHash)denied('permission_id_conflict');return {recorded:true,replayed:true};}
   const state={consent:'consented',decline:'declined',withdraw:'withdrawn'}[action];
   if(!participantId){participantId=randomUUID();await pool.query('INSERT INTO lab_participants(study_id,version,participant_id,state) VALUES($1,$2,$3,$4)',[studyId,version,participantId,state]);await pool.query('INSERT INTO lab_identity_map(study_id,version,participant_id,synthetic_subject) VALUES($1,$2,$3,$4)',[studyId,version,participantId,subject]);}
   const events=(await pool.query('SELECT sequence FROM lab_permissions WHERE study_id=$1 AND version=$2 AND participant_id=$3',[studyId,version,participantId])).rows;
   await pool.query('INSERT INTO lab_permissions(id,study_id,version,participant_id,action,purpose,notice_hash,language,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[eventId,studyId,version,participantId,action,'aggregate-research',noticeHash,language,events.length+1]);
   await pool.query('UPDATE lab_participants SET state=$4 WHERE study_id=$1 AND version=$2 AND participant_id=$3',[studyId,version,participantId,state]);
   const invalidated=action!=='consent'?await invalidate(studyId,version,participantId):[];
   if(action!=='consent')await pool.query('DELETE FROM lab_measurements WHERE study_id=$1 AND version=$2 AND participant_id=$3',[studyId,version,participantId]);
   return {recorded:true,state,invalidated,priorRecipientCopies:'cannot-be-recalled-by-software; follow agreed withdrawal protocol'};
  });},
  measure({studyId,version,subject,response,month}){return serial([studyId,version,subject,'measure'],async()=>{
   const s=await study(studyId,version);
   if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(5))<1||Number(month.slice(5))>12||month<s.protocol.window.fromMonth||month>s.protocol.window.toMonth)denied('measurement_outside_window');
   if(!['helpful','partly','not-yet','unknown'].includes(response))denied('unauthorized_field');
   const participantId=await mapped(studyId,version,subject);const p=(await pool.query('SELECT state FROM lab_participants WHERE study_id=$1 AND version=$2 AND participant_id=$3',[studyId,version,participantId])).rows[0];
   if(p?.state!=='consented')denied('current_permission_required');
   await pool.query('INSERT INTO lab_measurements(study_id,version,participant_id,response,month) VALUES($1,$2,$3,$4,$5) ON CONFLICT(study_id,version,participant_id) DO UPDATE SET response=EXCLUDED.response,month=EXCLUDED.month',[studyId,version,participantId,response,month]);return {recorded:true};
  });},
  release({studyId,version,actor}){return serial([studyId,version,actor,'release'],async()=>{
   const s=await study(studyId,version);await recipient(studyId,version,actor);
   const rows=(await pool.query("SELECT p.participant_id,m.response FROM lab_participants p LEFT JOIN lab_measurements m ON m.study_id=p.study_id AND m.version=p.version AND m.participant_id=p.participant_id WHERE p.study_id=$1 AND p.version=$2 AND p.state='consented'",[studyId,version])).rows;
   if(rows.length<s.protocol.minCellSize)denied('cohort_too_small');
   const counts={'helpful':0,'partly':0,'not-yet':0,'unknown':0,'missing':0};for(const r of rows)counts[r.response||'missing']++;
   const suppress=Object.values(counts).some(n=>n>0&&n<s.protocol.minCellSize);
   // All buckets suppressed together: totals cannot reveal a single withheld bucket by subtraction.
   const payload={synthetic:true,studyId,protocolVersion:version,protocolHash:s.protocol_hash,noticeHash:s.notice_hash,datasetVersion:'synthetic-helpfulness-aggregate-v1',instrument:s.protocol.instrument,purpose:'aggregate-research',recipient:actor,window:s.protocol.window,fields:['helpfulness'],participantCount:rows.length,counts:suppress?null:counts,suppression:{minimum:s.protocol.minCellSize,breakdownSuppressed:suppress},missingness:suppress?'withheld with entire breakdown':{unknown:counts.unknown,missing:counts.missing},provenance:'Synthetic fixtures only. One latest report per consenting simulated adult. No causal or learning claims.',exclusions:['names','emails','auth0-subjects','student-ids','summaries','audio','transcripts','profile-text','identity-map','model-training']};
   const manifestId=randomUUID(),checksum=hash(payload),expires=new Date(now().getTime()+s.protocol.retentionDays*86400000);
   await pool.query("INSERT INTO lab_manifests(id,study_id,version,recipient_id,payload,checksum,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'released-simulation',$7)",[manifestId,studyId,version,actor,JSON.stringify(payload),checksum,expires]);
   for(const r of rows)await pool.query('INSERT INTO lab_manifest_members(manifest_id,study_id,version,participant_id) VALUES($1,$2,$3,$4)',[manifestId,studyId,version,r.participant_id]);
   return {manifestId,checksum,payload,expiresAt:expires.toISOString()};
  });},
  read({studyId,version,actor,manifestId}){return serial([studyId,version,actor,'read'],async()=>{
   await study(studyId,version);await recipient(studyId,version,actor);
   const m=(await pool.query('SELECT * FROM lab_manifests WHERE id=$1 AND study_id=$2 AND version=$3 AND recipient_id=$4',[manifestId,studyId,version,actor])).rows[0];
   if(!m||m.status!=='released-simulation'||new Date(m.expires_at)<=now())denied('dataset_unavailable');
   return {manifestId,checksum:m.checksum,payload:m.payload};
  });},
  revoke({studyId,version,recipientId}){return serial([studyId,version,'synthetic-operator','revoke'],async()=>{
   await study(studyId,version,false);await pool.query('UPDATE lab_recipients SET revoked=true WHERE study_id=$1 AND version=$2 AND recipient_id=$3',[studyId,version,recipientId]);await pool.query("UPDATE lab_manifests SET status='invalidated' WHERE study_id=$1 AND version=$2 AND recipient_id=$3",[studyId,version,recipientId]);return {revoked:true};
  });},
  suspend({studyId,version}){return serial([studyId,version,'synthetic-operator','suspend'],async()=>{await study(studyId,version,false);await pool.query("UPDATE lab_study_versions SET status='suspended' WHERE study_id=$1 AND version=$2",[studyId,version]);return {suspended:true};});},
  purgeExpired(){return serial(['synthetic-retention',0,'synthetic-operator','retention'],async()=>{const rows=(await pool.query('SELECT id,expires_at FROM lab_manifests')).rows;let removed=0;for(const m of rows)if(new Date(m.expires_at)<=now()){await pool.query('DELETE FROM lab_manifests WHERE id=$1',[m.id]);removed++;}return {removed};});},
  audit(){return tail.then(async()=>({synthetic:true,events:(await pool.query('SELECT action,outcome,reason,study_id,version,recorded_at FROM lab_access_audit')).rows}));},
  close(){return tail.then(()=>pool.end());}
 };
}
