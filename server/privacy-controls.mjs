import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {recentlyAuthenticated} from './recent-auth.mjs';
import {runAsAccount} from './account-isolation.mjs';
import {safeErrorCode} from './api-logging.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const tables={summaries:'origen_conversation_summaries',notes:'origen_topic_notes',plans:'origen_plans',sheets:'origen_workspace_sheets',memories:'origen_student_memories'};
export function validatePrivacyRequest(input){
 if(!input||Array.isArray(input)||!['status','preview','erase','retention'].includes(input.action))throw fail(400,'invalid_privacy_request');
 const keys={status:['action'],preview:['action','categories','studentId'],erase:['action','categories','studentId','revision','confirmation'],retention:['action','days']}[input.action];
 if(Object.keys(input).some(k=>!keys.includes(k)))throw fail(400,'invalid_privacy_request');
 if(['preview','erase'].includes(input.action)){
  if(!Array.isArray(input.categories)||!input.categories.length||input.categories.length>5||new Set(input.categories).size!==input.categories.length||input.categories.some(k=>!Object.hasOwn(tables,k)))throw fail(400,'invalid_privacy_request');
  if(input.studentId!==undefined&&input.studentId!==null&&(typeof input.studentId!=='string'||!input.studentId||input.studentId.length>128))throw fail(400,'invalid_privacy_request');
 }
 if(input.action==='erase'&&(input.confirmation!=='DELETE'||typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision)))throw fail(400,'confirmation_required');
 if(input.action==='retention'&&![null,30,90,365].includes(input.days))throw fail(400,'invalid_privacy_request');
 return input;
}
export function createPrivacyRepository(database){return async(subject,input)=>{
 if(!database)throw fail(503,'privacy_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
  if(!account)throw fail(404,'account_not_found');const owner=account.id;
  const prefs=async()=>((await c.query('SELECT summary_days FROM origen_privacy_preferences WHERE account_id=$1',[owner])).rows[0]?.summary_days??null);
  if(input.action==='retention'){
   await c.query('INSERT INTO origen_privacy_preferences(account_id,summary_days) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET summary_days=$2,updated_at=now()',[owner,input.days]);
   await c.query('COMMIT');return {days:input.days};
  }
  if(input.action==='expire'){
   const days=await prefs();let removed=0;
   if(days!==null){const cutoff=new Date(Date.now()-days*86400000).toISOString();removed=(await c.query('DELETE FROM origen_conversation_summaries WHERE account_id=$1 AND created_at<$2',[owner,cutoff])).rowCount;}
   await c.query('COMMIT');return {removed};
  }
  if(input.studentId!==undefined&&input.studentId!==null&&!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows.length)throw fail(404,'student_not_found');
  const all={},selected={},args=[owner,...(typeof input.studentId==='string'?[input.studentId]:[])];
  const scope=input.studentId===undefined?'':input.studentId===null?' AND student_id IS NULL':' AND student_id=$2';
  for(const [key,table] of Object.entries(tables)){
   if(key==='memories'&&!(await c.query("SELECT table_name FROM information_schema.tables WHERE table_name='origen_student_memories'")).rows.length){all[key]=[];selected[key]=[];continue;}
   // Include versions so a confirmation cannot silently erase newly edited work.
   all[key]=(await c.query(`SELECT id,${key==='summaries'?'created_at':'version'},${['notes','memories'].includes(key)?'source_summary_id':'student_id'} FROM ${table} WHERE account_id=$1${scope}${key==='memories'?" AND status IN ('proposed','confirmed')":''} ORDER BY id`,args)).rows;
   selected[key]=(input.categories||[]).includes(key)?all[key]:[];
  }
  if(input.action==='status'){
   const students=(await c.query('SELECT id,name FROM origen_students WHERE account_id=$1 ORDER BY name,id',[owner])).rows;
   const result={counts:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,v.length])),days:await prefs(),students};await c.query('COMMIT');return result;
  }
  const summaryIds=new Set(selected.summaries.map(r=>r.id));
  const derived=all.notes.filter(r=>summaryIds.has(r.source_summary_id));
  selected.notes=[...new Map([...selected.notes,...derived].map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const derivedMemories=all.memories.filter(r=>summaryIds.has(r.source_summary_id));
  selected.memories=[...new Map([...selected.memories,...derivedMemories].map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const counts=Object.fromEntries(Object.entries(selected).map(([k,v])=>[k,v.length]));
  const revision=createHash('sha256').update(JSON.stringify({owner,studentId:input.studentId,categories:[...input.categories].sort(),selected})).digest('hex');
  if(input.action==='erase'){
   if(input.revision!==revision)throw fail(409,'privacy_selection_changed');
   if(input.categories.includes('memories')){
    const sources=(await c.query(`SELECT id,student_id FROM origen_conversation_summaries WHERE account_id=$1${scope}`,args)).rows;
    for(const source of sources)await c.query("INSERT INTO origen_memory_batches(account_id,summary_id,source_version,suppressed) VALUES($1,$2,'privacy-erased',true) ON CONFLICT(account_id,summary_id) DO UPDATE SET suppressed=true",[owner,source.id]);
    const targets=input.studentId!==undefined?[input.studentId]:[null,...(await c.query('SELECT id FROM origen_students WHERE account_id=$1',[owner])).rows.map(r=>r.id)];
    for(const target of targets)await c.query('INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES($1,$2,$3) ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1',[owner,target??'',target]);
   }
   if(input.categories.includes('notes')){
    // Erasing notes also fences an extraction already in flight. Empty source
    // receipts prevent old summaries from automatically recreating removed notes.
    await c.query(`INSERT INTO origen_topic_note_batches(account_id,summary_id) SELECT account_id,id FROM origen_conversation_summaries WHERE account_id=$1${scope} ON CONFLICT DO NOTHING`,args);
    if((await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_binder_jobs'")).rows.length)await c.query(`UPDATE origen_binder_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=$1${scope} AND status<>'complete'`,args);
   }
   // Receipts/tombstones are written by DB triggers, including normal UI deletes.
   for(const key of ['summaries','notes','plans','sheets','memories'])for(const row of selected[key])await c.query(`DELETE FROM ${tables[key]} WHERE account_id=$1 AND id=$2`,[owner,row.id]);
  }
  await c.query('COMMIT');return {counts,derivedNotes:derived.length,derivedMemories:derivedMemories.length,revision,deleted:input.action==='erase'};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
// Called only by the scheduled retention job. The repository rechecks the
// preference under the same account lock as saves/closure before each sweep.
export async function purgePrivateSummaries(database){
 if(!database)return;
 const candidates=(await database.query("SELECT a.auth0_subject FROM origen_accounts a JOIN origen_privacy_preferences p ON p.account_id=a.id WHERE p.summary_days IS NOT NULL AND EXISTS(SELECT 1 FROM origen_conversation_summaries s WHERE s.account_id=a.id AND s.created_at<now()-p.summary_days*interval '1 day') ORDER BY a.id LIMIT 50")).rows;
 const run=createPrivacyRepository(database);
 for(const {auth0_subject:sub} of candidates)try{await runAsAccount({sub},()=>run(sub,{action:'expire'}));}catch(error){if(![403,404].includes(error.status))throw error;}
}
export function createPrivacyHandler(database){const run=createPrivacyRepository(database);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/privacy')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'too_large'});}
  let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_privacy_request');}validatePrivacyRequest(input);
  if(['erase','retention'].includes(input.action)&&!recentlyAuthenticated(req.origenIdentity))return send(403,{error:'reauthentication_required'});
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'database_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'privacy_unavailable'});}
};}
