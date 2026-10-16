import {randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {assertPermission} from './permission-context.mjs';
import {uuid} from './observability/wire.mjs';

export const supportPurposes=Object.freeze(['sign-in','onboarding','voice','saving','availability']);
const fail=(status=404)=>Object.assign(new Error(status===400?'invalid_support_request':status===429?'rate_limited':'support_unavailable'),{status});
export async function assertSupportReady(database){
 const row=(await database.query(`SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='043_support_diagnostics.sql') AS ready,
 (SELECT count(*)=5 FROM pg_trigger WHERE tgname IN('support_case_deleted','support_case_closed','support_operation_deleted','support_permission_changed','support_staff_changed') AND tgenabled='O') AS captures,
 has_table_privilege(current_user,'origen_support_cases','SELECT') AND has_table_privilege(current_user,'origen_support_cases','INSERT') AND has_column_privilege(current_user,'origen_support_cases','status','UPDATE') AS usable,
 has_column_privilege(current_user,'origen_support_cases','operation_ids','UPDATE') OR has_function_privilege(current_user,'origen_support_scope(uuid,text,bigint,boolean)','EXECUTE') AS broad`)).rows[0];
 if(!row?.ready||!row.captures||!row.usable||row.broad)throw new Error('support_migration_required');
}
export function createSupportRepository(database,{environment='development'}={}){
 return async(subject,input)=>{
  if(!database)throw fail(503);
  if(!input||!['report','close'].includes(input.action)||!supportPurposes.includes(input.purpose)||!uuid(input.reference))throw fail(400);
  const c=await database.connect();let committed=false;
  try{
   await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='2s'");await guardAccountTransaction(c,subject);
   const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];if(!account)throw fail();
   if(input.action==='close'){
    const row=(await c.query("UPDATE origen_support_cases SET status='closed' WHERE id=$1 AND account_id=$2 AND purpose=$3 RETURNING id",[input.reference,account.id,input.purpose])).rows[0];if(!row)throw fail();
    await c.query('COMMIT');committed=true;return {caseId:row.id,status:'closed'};
   }
   // Owner lock makes this budget race-safe. Unknown and foreign references use
   // the same response; no identity search, arbitrary window, or scope expansion.
   const count=(await c.query("SELECT count(*) FROM origen_support_cases WHERE account_id=$1 AND created_at>now()-interval '1 hour'",[account.id])).rows[0];if(Number(count.count)>=10)throw fail(429);
   const row=(await c.query(`SELECT d.operation_id,COALESCE((SELECT r.created_at FROM origen_diagnostic_request_refs r WHERE r.request_id=$2 AND r.operation_id=d.operation_id AND r.account_id=$1 AND r.expires_at>now()),d.created_at) AS anchor_at FROM origen_diagnostic_operations d WHERE d.account_id=$1 AND d.expires_at>now() AND (d.operation_id=$2 OR EXISTS(SELECT 1 FROM origen_diagnostic_request_refs r WHERE r.request_id=$2 AND r.operation_id=d.operation_id AND r.account_id=$1 AND r.expires_at>now())) LIMIT 1`,[account.id,input.reference])).rows[0];if(!row)throw fail();
   const caseId=randomUUID(),at=new Date(row.anchor_at).getTime();
   await c.query('INSERT INTO origen_support_cases(id,account_id,origin,purpose,environment,operation_ids,window_start,window_end) VALUES($1,$2,\'user_report\',$3,$4,$5,$6,$7)',[caseId,account.id,input.purpose,environment,[row.operation_id],new Date(at-900000),new Date(at+900000)]);
   await assertPermission(c);await c.query('COMMIT');committed=true;return {caseId,status:'open'};
  }finally{if(!committed)await c.query('ROLLBACK').catch(()=>{});c.release();}
 };
}
export function createSupportHandler(database,env={}){
 const repository=createSupportRepository(database,{environment:env.OBSERVABILITY_ENVIRONMENT||env.NODE_ENV||'development'});
 return async(req,res,next)=>{
  if(req.url!=='/api/support-diagnostics')return next();
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(env.SUPPORT_DIAGNOSTICS_ENABLED!=='true')return send(404,{error:'not_found'});
  let timer;
  try{
   const read=(async()=>{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024)throw fail(400);chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString());})();
   const input=await Promise.race([read,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(400)),2000);})]);
   if(Object.keys(input).sort().join(',')!=='action,purpose,reference')throw fail(400);
   return send(200,await repository(req.origenIdentity.sub,input));
  }catch(error){return send([400,404,429].includes(error.status)?error.status:503,{error:'support_unavailable'});}finally{clearTimeout(timer);}
 };
}
