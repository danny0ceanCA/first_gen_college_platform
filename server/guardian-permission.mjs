import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {subjectHash} from './account-lifecycle.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {runAsGuardian} from './account-isolation.mjs';
import {eligibilityAllowed} from './permission-context.mjs';
import {createGuardianMailer,GUARDIAN_NOTICE_VERSION,GUARDIAN_NOTICE} from './guardian-email.mjs';
import {createGuardianRateLimit} from './guardian-rate-limit.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
const validToken=token=>typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token);
export function eligibilityView(row,now=Date.now()){
 return {status:row?(row.status==='approved'&&!eligibilityAllowed(row,now)?'expired':row.status):'unknown',allowed:eligibilityAllowed(row,now),ageBand:row?.age_band,requestId:row?.request_id,delivery:row?.delivery,noticeVersion:GUARDIAN_NOTICE_VERSION,permissionExpiresAt:row?.permission_expires_at};
}
export function createPermissionRepository(database,{mailer=createGuardianMailer(),clock=()=>Date.now()}={}){
 const available=()=>{if(!database)throw fail(503,'permission_unavailable');};
 const read=async(subject)=>{available();return (await database.query('SELECT * FROM origen_eligibility WHERE subject_hash=$1',[subjectHash(subject)])).rows[0];};
 const event=async(c,row,decision)=>c.query('INSERT INTO origen_permission_events(id,subject_hash,request_id,notice_version,decision,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),row.subject_hash,row.request_id,GUARDIAN_NOTICE_VERSION,decision,new Date(clock())]);
 async function account(subject,input){
  available();if(input.action==='status')return eligibilityView(await read(subject),clock());
  const c=await database.connect();let row,mail;
  try{
   await c.query('BEGIN');await guardAccountTransaction(c,subject);
   const hash=subjectHash(subject),now=clock();
   row=(await c.query('SELECT * FROM origen_eligibility WHERE subject_hash=$1 FOR UPDATE',[hash])).rows[0];
   if(input.action==='screen'){
    if(!['under13','13to17','18plus'].includes(input.ageBand)||!['grade9plus','adult_supporter','other'].includes(input.audience))throw fail(400,'invalid_eligibility');
    if(row)throw fail(409,'eligibility_already_recorded'); // No self-service age correction/bypass.
    const eligible=input.audience==='grade9plus'||input.ageBand==='18plus'&&input.audience==='adult_supporter';
    const status=input.ageBand==='under13'||!eligible?'blocked':input.ageBand==='18plus'?'adult':'pending';
    row=(await c.query('INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *',[hash,input.ageBand,input.audience,status,GUARDIAN_NOTICE_VERSION,new Date(now)])).rows[0];
    await event(c,row,'screened');
   }else if(input.action==='request'){
    if(!row||row.age_band!=='13to17'||!['pending','approved'].includes(row.status)||eligibilityAllowed(row,now))throw fail(403,'guardian_request_not_available');
    const to=typeof input.guardianEmail==='string'?input.guardianEmail.trim().toLowerCase():'';
    if(to.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to))throw fail(400,'invalid_guardian_email');
    if(row.requested_at&&now-Date.parse(row.requested_at)<60000)throw fail(429,'guardian_request_cooldown');
    const sameWindow=row.window_started_at&&now-Date.parse(row.window_started_at)<86400000;
    if(sameWindow&&row.request_count>=3)throw fail(429,'guardian_request_daily_limit');
    const approvalToken=randomBytes(32).toString('base64url'),withdrawalToken=randomBytes(32).toString('base64url'),requestId=randomUUID();
    row=(await c.query(`UPDATE origen_eligibility SET status='pending',revision=revision+1,request_id=$2,guardian_email=$3,approval_hash=$4,withdrawal_hash=$5,
     approval_expires_at=$6,permission_expires_at=$7,requested_at=$8,updated_at=$8,window_started_at=$9,request_count=$10,decided_at=NULL,delivery='disabled',notice_version=$11 WHERE subject_hash=$1 RETURNING *`,
    [hash,requestId,to,tokenHash(approvalToken),tokenHash(withdrawalToken),new Date(now+48*3600000),new Date(now+180*86400000),new Date(now),sameWindow?row.window_started_at:new Date(now),sameWindow?row.request_count+1:1,GUARDIAN_NOTICE_VERSION])).rows[0];
    await event(c,row,'requested');mail={to,requestId,approvalToken,withdrawalToken};
   }else if(input.action==='withdraw'){
    if(!row||!['pending','approved','adult'].includes(row.status))throw fail(409,'permission_not_active');
    row=(await c.query("UPDATE origen_eligibility SET status='revoked',guardian_email=NULL,revision=revision+1,decided_at=$2,updated_at=$2 WHERE subject_hash=$1 RETURNING *",[hash,new Date(now)])).rows[0];await event(c,row,'revoked');
   }else throw fail(400,'invalid_request');
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  if(mail){let delivery;try{delivery=await mailer.send(mail);}catch{delivery='failed';}
   if(!['disabled','mock','accepted','failed'].includes(delivery))delivery='failed';
   await database.query('UPDATE origen_eligibility SET delivery=$3 WHERE subject_hash=$1 AND request_id=$2',[subjectHash(subject),mail.requestId,delivery]);
   row=await read(subject);
  }
  return eligibilityView(row,clock());
 }
 async function guardian(input,{onMatched=()=>{}}={}){
  available();if(!validToken(input.token)||!['view','approve','decline','withdraw'].includes(input.action))throw fail(400,'invalid_request');
  const hash=tokenHash(input.token);
  return runAsGuardian(hash,async()=>{
   const c=await database.connect();
   try{
    await c.query('BEGIN');
    let row=(await c.query('SELECT * FROM origen_eligibility WHERE approval_hash=$1 OR withdrawal_hash=$1',[hash])).rows[0];
    if(!row)throw fail(410,'permission_link_unavailable');
    onMatched(hash); // Limit a real capability before acquiring subject locks.
    await c.query('SELECT subject_hash FROM origen_subject_locks WHERE subject_hash=$1 FOR UPDATE',[row.subject_hash]);
    row=(await c.query('SELECT * FROM origen_eligibility WHERE approval_hash=$1 OR withdrawal_hash=$1 FOR UPDATE',[hash])).rows[0];
    if(!row)throw fail(410,'permission_link_unavailable');
    const withdrawal=row.withdrawal_hash===hash,now=clock();
    if(withdrawal?(!['pending','approved'].includes(row.status)||Date.parse(row.permission_expires_at)<=now):(row.status!=='pending'||Date.parse(row.approval_expires_at)<=now))throw fail(410,'permission_link_unavailable');
    if(input.action==='view'){await c.query('COMMIT');return {kind:withdrawal?'withdrawal':'approval',requestId:row.request_id,noticeVersion:row.notice_version,notice:GUARDIAN_NOTICE,permissionExpiresAt:row.permission_expires_at};}
    // Withdrawal stops an existing grant; a newer approval notice must never
    // invalidate the guardian's still-active withdrawal capability.
    if(input.confirmed!==true||!withdrawal&&(row.notice_version!==GUARDIAN_NOTICE_VERSION||input.noticeVersion!==GUARDIAN_NOTICE_VERSION))throw fail(400,'guardian_confirmation_required');
    if(withdrawal?input.action!=='withdraw':!['approve','decline'].includes(input.action))throw fail(403,'permission_link_wrong_action');
    const status=input.action==='approve'?'approved':input.action==='decline'?'denied':'revoked';
    // Consumed links remain hashed for replay detection. State prevents reuse;
    // keeping the matching hash also keeps UPDATE RLS's WITH CHECK restrictive.
    row=(await c.query("UPDATE origen_eligibility SET status=$2,guardian_email=CASE WHEN $2='approved' THEN guardian_email ELSE NULL END,revision=revision+1,decided_at=$3,updated_at=$3 WHERE subject_hash=$1 RETURNING *",[row.subject_hash,status,new Date(now)])).rows[0];
    await event(c,row,status);await c.query('COMMIT');return {status};
   }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  });
 }
 return {read,account,guardian};
}
export async function purgePermissionData(database,now=new Date()){
 if(!database)return;
 await database.query("UPDATE origen_eligibility SET guardian_email=NULL,approval_hash=NULL,withdrawal_hash=NULL WHERE (status='pending' AND requested_at<$1) OR (status IN ('denied','revoked') AND updated_at<$1) OR (status='approved' AND permission_expires_at<$2)",[new Date(now.getTime()-30*86400000),now]);
 await database.query('DELETE FROM origen_permission_events WHERE occurred_at<$1',[new Date(now.getTime()-365*86400000)]);
}
export function createPermissionHandler(database,env={},options={}){
 const repository=createPermissionRepository(database,{mailer:createGuardianMailer(env),...options});
 const rateLimit=createGuardianRateLimit();
 return {repository,async handle(req,res,publicGuardian=false){
  let matched=false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(!req.headers['content-type']?.startsWith('application/json'))throw fail(415,'json_required');
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw fail(413,'too_large');}
   let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_request');}
   const keys=publicGuardian?['action','token','noticeVersion','confirmed']:['action','ageBand','audience','guardianEmail'];
   if(!input||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw fail(400,'invalid_request');
   return send(200,publicGuardian?await rateLimit.lookup(()=>repository.guardian(input,{onMatched:hash=>{matched=true;rateLimit.capability(hash);}})):{...await repository.account(req.origenIdentity.sub,input),subject:req.origenIdentity.sub});
  }catch(error){
   // An indexed lookup is necessary to distinguish a fresh valid capability
   // from guesses, even if invalid traffic has exhausted this proxy's budget.
   if(publicGuardian&&!matched){try{rateLimit.invalid(req.socket?.remoteAddress||'unknown');}catch(limited){error=limited;}}
   const status=[400,403,409,410,413,415,429].includes(error.status)?error.status:503;return send(status,{error:status===503?'permission_unavailable':error.message});
  }
 }};
}
