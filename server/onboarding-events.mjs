import {guardAccountTransaction} from './account-guard.mjs';
import {onboardingUUID,sanitizeOnboardingMetadata,onboardingEventName} from '../src/onboardingEventSchema.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';
export {onboardingUUID,sanitizeOnboardingMetadata};
const invalid=()=>{throw Object.assign(new Error('invalid_onboarding_event'),{status:400});};
export function onboardingBatch(input,now=Date.now()){
 if(!input||!onboardingUUID(input.attemptId)||!Array.isArray(input.events)||!input.events.length||input.events.length>25)return invalid();
 const events=input.events.map(event=>{
  if(!event||!onboardingEventName(event.name)||!Number.isInteger(event.sequence)||event.sequence<1||event.sequence>2000)return invalid();
  const time=typeof event.occurredAt==='string'?Date.parse(event.occurredAt):NaN;
  if(!Number.isFinite(time)||time>now+300000||time<now-86400000)return invalid();
  const metadata=sanitizeOnboardingMetadata(event.metadata);
  return {sequence:event.sequence,name:event.name,occurredAt:new Date(time).toISOString(),metadata};
 });
 if(new Set(events.map(event=>event.sequence)).size!==events.length)return invalid();
 return {attemptId:input.attemptId,events};
}
// Ownership always comes from the authenticated subject, including late events.
export async function ensureOnboardingAttempt(client,owner,id){
 await client.query(`INSERT INTO origen_onboarding_attempts(account_id,id,resumed)
  SELECT $1,$2,EXISTS(SELECT 1 FROM origen_onboarding_attempts WHERE account_id=$1 AND id<>$2)
  ON CONFLICT(account_id,id) DO NOTHING`,[owner,id]);
}
export async function recordOnboardingSave(client,owner,id){
 if(!id)return;
 // A diagnostic failure must not roll back the actual profile save.
 await client.query('SAVEPOINT origen_onboarding_tracking');
 try{
  const exists=(await client.query('SELECT id FROM origen_onboarding_attempts WHERE account_id=$1 AND id=$2',[owner,id])).rows.length;
  const count=Number((await client.query('SELECT count(*) AS count FROM origen_onboarding_attempts WHERE account_id=$1',[owner])).rows[0].count);
  if(exists||count<200){
   await ensureOnboardingAttempt(client,owner,id);
   await client.query('UPDATE origen_onboarding_attempts SET saved_at=COALESCE(saved_at,now()),last_received_at=now() WHERE account_id=$1 AND id=$2',[owner,id]);
   await client.query(`INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at)
    VALUES($1,$2,'server',1,'profile_saved',now()) ON CONFLICT DO NOTHING`,[owner,id]);
  }
 }catch{
  await client.query('ROLLBACK TO SAVEPOINT origen_onboarding_tracking');
  console.warn('Origen onboarding save tracking was unavailable.');
 }finally{await client.query('RELEASE SAVEPOINT origen_onboarding_tracking');}
}
export async function storeOnboardingBatch(database,subject,input){
 const client=await database.connect();
 try{
  await client.query('BEGIN');await guardAccountTransaction(client,subject);
  const owner=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0]?.id;
  if(!owner)throw Object.assign(new Error('account_not_found'),{status:404});
  // Bounded per account as well as per attempt. Row locking serializes checks.
  const exists=(await client.query('SELECT id FROM origen_onboarding_attempts WHERE account_id=$1 AND id=$2',[owner,input.attemptId])).rows.length;
  if(!exists&&Number((await client.query('SELECT count(*) AS count FROM origen_onboarding_attempts WHERE account_id=$1',[owner])).rows[0].count)>=200)throw Object.assign(new Error('onboarding_event_limit'),{status:429});
  await ensureOnboardingAttempt(client,owner,input.attemptId);
  let inserted=0;
  for(const event of input.events){const result=await client.query(`INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at,metadata)
   VALUES($1,$2,'client',$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[owner,input.attemptId,event.sequence,event.name,event.occurredAt,event.metadata]);inserted+=result.rowCount||0;}
  if(inserted)await client.query('UPDATE origen_onboarding_attempts SET last_received_at=now() WHERE account_id=$1 AND id=$2',[owner,input.attemptId]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export function createOnboardingHandler(database){return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/onboarding-events')return next();
 const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
 if(!req.origenAuthorized||typeof req.origenIdentity?.sub!=='string')return send(401,'authentication_required');
 if(req.method!=='POST')return send(405,'method_not_allowed');
 if(!database)return send(503,'database_not_ready');
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,'json_required');
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000)return send(413,'request_too_large');}
  let input;try{input=onboardingBatch(JSON.parse(raw));}catch{return send(400,'invalid_onboarding_event');}
  await storeOnboardingBatch(database,req.origenIdentity.sub,input);return send(200);
 }catch(error){return send([403,404,429].includes(error.status)?error.status:503,[403,404,429].includes(error.status)?error.message:'onboarding_tracking_unavailable');}
};}
export async function purgeOnboardingEvents(database,now=new Date(),env={}){
 const {retentionDays}=onboardingSettings(env);
 if(database)await database.query('DELETE FROM origen_onboarding_attempts WHERE last_received_at<$1',[new Date(now.getTime()-retentionDays*86400000).toISOString()]);
}

