import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {safeErrorCode} from './api-logging.mjs';

export const sharedColumns=['name','stage','interest','gpa','color','institutions','entry_term','school','activities','goals'];
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const hash=token=>createHash('sha256').update(token).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function validateLinkRequest(input){
 if(!input||typeof input!=='object')fail(400,'invalid_link_request');
 if(input.action==='load')return {action:'load'};
 if(input.action==='create'&&typeof input.studentId==='string'&&input.studentId.length>0&&input.studentId.length<=128&&['parent','student'].includes(input.role))return {action:'create',studentId:input.studentId,role:input.role};
 if(['inspect','accept'].includes(input.action)&&typeof input.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.token))return {action:input.action,token:input.token};
 if(['revoke','unlink'].includes(input.action)&&uuid(input.id))return {action:input.action,id:input.id};
 fail(400,'invalid_link_request');
}
export function createLinksRepository(database){
 return async(subject,input)=>{
  const client=await database.connect();
  try{
   await client.query('BEGIN');
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES ($1) ON CONFLICT (auth0_subject) DO NOTHING',[subject]);
   const account=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0].id;
   let extra={};
   if(input.action==='create'){
    const student=(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[account,input.studentId])).rows[0];
    if(!student)fail(404,'student_not_found');
    if((await client.query('SELECT id FROM origen_student_links WHERE member_account_id=$1 AND member_student_id=$2',[account,input.studentId])).rows.length)fail(409,'only_profile_owner_can_invite');
    // One active invitation per profile/role; generating another invalidates the old link.
    await client.query('UPDATE origen_family_invites SET revoked_at=now() WHERE owner_account_id=$1 AND student_id=$2 AND target_role=$3 AND consumed_at IS NULL AND revoked_at IS NULL',[account,input.studentId,input.role]);
    const token=randomBytes(32).toString('base64url');
    const invite=(await client.query('INSERT INTO origen_family_invites(owner_account_id,student_id,target_role,token_hash) VALUES ($1,$2,$3,$4) RETURNING id,expires_at',[account,input.studentId,input.role,hash(token)])).rows[0];
    extra={token,inviteId:invite.id,expiresAt:invite.expires_at};
   }
   if(input.action==='inspect'||input.action==='accept'){
    const invite=(await client.query('SELECT * FROM origen_family_invites WHERE token_hash=$1 AND expires_at>now() AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE',[hash(input.token)])).rows[0];
    if(!invite)fail(410,'invitation_unavailable');
    if(invite.owner_account_id===account)fail(409,'cannot_accept_own_invitation');
    if(input.action==='inspect'){
     const student=(await client.query('SELECT name FROM origen_students WHERE account_id=$1 AND id=$2',[invite.owner_account_id,invite.student_id])).rows[0];
     const inviter=(await client.query('SELECT first_name FROM origen_accounts WHERE id=$1',[invite.owner_account_id])).rows[0];
     if(!student||!inviter)fail(410,'invitation_unavailable');
     extra={invitation:{studentName:student.name,inviterName:inviter.first_name,role:invite.target_role,expiresAt:invite.expires_at}};
    }
    else{
     if((await client.query('SELECT id FROM origen_student_links WHERE owner_account_id=$1 AND owner_student_id=$2 AND member_account_id=$3',[invite.owner_account_id,invite.student_id,account])).rows.length)fail(409,'already_linked');
     // New isolated row, so same IDs in unrelated accounts never collide and no private data is copied.
     const localId=`linked-${randomUUID()}`;
     await client.query(`INSERT INTO origen_students(account_id,id,${sharedColumns.join(',')}) SELECT $1,$2,${sharedColumns.join(',')} FROM origen_students WHERE account_id=$3 AND id=$4`,[account,localId,invite.owner_account_id,invite.student_id]);
     await client.query('INSERT INTO origen_student_links(owner_account_id,owner_student_id,member_account_id,member_student_id,member_role) VALUES ($1,$2,$3,$4,$5)',[invite.owner_account_id,invite.student_id,account,localId,invite.target_role]);
     await client.query('UPDATE origen_family_invites SET consumed_at=now() WHERE id=$1',[invite.id]);
     extra={studentId:localId};
    }
   }
   if(input.action==='revoke'){
    if(!(await client.query('UPDATE origen_family_invites SET revoked_at=now() WHERE id=$1 AND owner_account_id=$2 AND consumed_at IS NULL RETURNING id',[input.id,account])).rows.length)fail(404,'invitation_not_found');
   }
   if(input.action==='unlink'){
    const link=(await client.query('SELECT * FROM origen_student_links WHERE id=$1 AND (owner_account_id=$2 OR member_account_id=$2) FOR UPDATE',[input.id,account])).rows[0];
    if(!link)fail(404,'link_not_found');
    // Keep the last shared academic snapshot and each person's own private history.
    const snapshot=(await client.query(`SELECT ${sharedColumns.join(',')} FROM origen_students WHERE account_id=$1 AND id=$2 FOR UPDATE`,[link.owner_account_id,link.owner_student_id])).rows[0];
    if(snapshot)await client.query(`UPDATE origen_students SET ${sharedColumns.map((c,i)=>`${c}=$${i+3}`).join(',')},updated_at=now() WHERE account_id=$1 AND id=$2`,[link.member_account_id,link.member_student_id,...sharedColumns.map(c=>snapshot[c])]);
    await client.query('DELETE FROM origen_student_links WHERE id=$1',[link.id]);
   }
   const links=(await client.query(`SELECT l.id,CASE WHEN l.owner_account_id=$1 THEN l.owner_student_id ELSE l.member_student_id END AS "studentId",s.name AS "studentName",a.first_name AS "personName",l.member_role AS role,(l.owner_account_id=$1) AS "isOwner" FROM origen_student_links l JOIN origen_students s ON s.account_id=l.owner_account_id AND s.id=l.owner_student_id JOIN origen_accounts a ON a.id=CASE WHEN l.owner_account_id=$1 THEN l.member_account_id ELSE l.owner_account_id END WHERE l.owner_account_id=$1 OR l.member_account_id=$1 ORDER BY l.created_at`,[account])).rows;
   const invites=(await client.query(`SELECT i.id,i.student_id AS "studentId",s.name AS "studentName",i.target_role AS role,i.expires_at AS "expiresAt" FROM origen_family_invites i JOIN origen_students s ON s.account_id=i.owner_account_id AND s.id=i.student_id WHERE i.owner_account_id=$1 AND i.expires_at>now() AND i.revoked_at IS NULL AND i.consumed_at IS NULL ORDER BY i.created_at DESC`,[account])).rows;
   await client.query('COMMIT');return {...extra,links,invites};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 };
}
export function createLinksHandler(database,run=database?createLinksRepository(database):null){
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/account-links')return next();
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!run)return send(503,{error:'database_not_ready'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'request_too_large'});}
   let input;try{input=validateLinkRequest(JSON.parse(raw));}catch{return send(400,{error:'invalid_link_request'});}
   return send(200,await run(req.origenIdentity.sub,input));
  }catch(error){const status=[400,404,409,410].includes(error.status)?error.status:503;if(status===503)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(status,{error:status===503?'links_unavailable':error.message});}
 };
}
