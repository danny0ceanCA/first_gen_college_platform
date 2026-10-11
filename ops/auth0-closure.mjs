import {createHash} from 'node:crypto';
// A dedicated operator token with delete:users, never a browser/API credential.
// The operator supplies the Auth0 user ID; the database retains only its hash.
export async function completeIdentityClosure(pool,{subject,domain,token},fetchImpl=fetch){
 if(domain!=='origenedu.us.auth0.com'||typeof subject!=='string'||!subject.trim()||subject.length>255||subject.includes('\0')||!token)throw new Error('invalid_identity_closure_configuration');
 const key=createHash('sha256').update(subject).digest('hex'),c=await pool.connect();try{
  await c.query('BEGIN');
  const row=(await c.query('SELECT i.completed_at FROM origen_identity_closures i JOIN origen_closed_accounts c USING(subject_hash) WHERE i.subject_hash=$1 FOR UPDATE OF i',[key])).rows[0];
  if(!row)throw new Error('verified_closure_required');
  if(!row.completed_at){
   const response=await fetchImpl(`https://${domain}/api/v2/users/${encodeURIComponent(subject)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
   // Auth0 DELETE is idempotent (204 for absent users). Do not treat a proxy's
   // 404 or a rate-limit/permission error as proof of deletion.
   if(response.status!==204)throw new Error('identity_provider_deletion_failed');
   await c.query('UPDATE origen_identity_closures SET completed_at=now() WHERE subject_hash=$1',[key]);
  }
  await c.query('COMMIT');return {completed:true,alreadyCompleted:!!row.completed_at};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
