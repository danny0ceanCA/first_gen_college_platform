import {createHash} from 'node:crypto';
import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {recentlyAuthenticated} from './recent-auth.mjs';
export const subjectHash=subject=>createHash('sha256').update(subject).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function accountClosed(database,subject){
 if(!database)return false;
 return (await database.query('SELECT subject_hash FROM origen_closed_accounts WHERE subject_hash=$1',[subjectHash(subject)])).rows.length>0;
}
export async function purgeExpiredInvites(database){
 if(database)await database.query('DELETE FROM origen_family_invites WHERE expires_at < now()');
}
export function createLifecycleRepository(database){return async(subject,input)=>{
 if(!database)throw fail(503,'database_not_ready');
 const c=await database.connect();
 try{
  await c.query('BEGIN');
  await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT * FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
  if(input.action==='export'){
   const rows=async(table)=>account?(await c.query(`SELECT * FROM ${table} WHERE account_id=$1`,[account.id])).rows:[];
   const representatives=(await c.query('SELECT first_name,work_email,job_role,created_at FROM origen_institution_representatives WHERE auth0_subject=$1',[subject])).rows;
   const memberships=(await c.query('SELECT institution_id,role FROM origen_institution_members WHERE auth0_subject=$1',[subject])).rows;
   const data={formatVersion:1,exportedAt:new Date().toISOString(),account:account?{firstName:account.first_name,email:account.email,createdAt:account.created_at}:null,
    students:await rows('origen_students'),summaries:await rows('origen_conversation_summaries'),plans:await rows('origen_plans'),planSteps:await rows('origen_plan_steps'),planSources:await rows('origen_plan_sources'),planConversations:await rows('origen_plan_conversations'),representatives,memberships};
   // No invite tokens/hashes, other participants' private data or identity credentials.
   await c.query('COMMIT');return data;
  }
  if(input.action!=='delete'||input.confirmation!=='DELETE')throw fail(400,'confirmation_required');
  if(account&&(await c.query('SELECT id FROM origen_student_links WHERE owner_account_id=$1 OR member_account_id=$1',[account.id])).rows.length)throw fail(409,'unlink_family_first');
  if((await c.query('SELECT institution_id FROM origen_institution_members WHERE auth0_subject=$1',[subject])).rows.length)throw fail(409,'institution_membership_requires_review');
  if((await c.query('SELECT id FROM origen_institution_reviews WHERE reviewer_subject=$1',[subject])).rows.length)throw fail(409,'reviewer_records_require_review');
  await c.query('INSERT INTO origen_closed_accounts(subject_hash) VALUES($1) ON CONFLICT(subject_hash) DO NOTHING',[subjectHash(subject)]);
  if(account)await c.query('DELETE FROM origen_accounts WHERE id=$1',[account.id]);
  await c.query('DELETE FROM origen_institution_representatives WHERE auth0_subject=$1',[subject]);
  await c.query('COMMIT');return {deleted:true,identityProviderDeletion:'pending',backupDeletion:'provider_retention',closureReceipt:'subject_sha256'};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
export function createLifecycleHandler(database){const run=createLifecycleRepository(database);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/account-data')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return send(413,{error:'too_large'});}
  let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_request');}
  if(!input||Array.isArray(input)||!['export','delete'].includes(input.action)||Object.keys(input).some(k=>!['action','confirmation'].includes(k)))throw fail(400,'invalid_request');
  if(input.action==='delete'&&!recentlyAuthenticated(req.origenIdentity))return send(403,{error:'reauthentication_required'});
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(error){const known=[400,403,409].includes(error.status);if(!known)req.log?.({event:'database_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'account_data_unavailable'});}
};}
