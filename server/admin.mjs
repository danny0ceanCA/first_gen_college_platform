import {reviewConversationFinding} from './conversation-reviews.mjs';
import {adminOverview} from './admin-overview.mjs';
import {adminUsers,adminUserDetail} from './admin-users.mjs';
import {adminVoiceQuality} from './voice-quality.mjs';
import {adminConversationQuality} from './conversation-quality-store.mjs';
import {adminInstitutionReport} from './admin-institutions.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAdmin(subject,env){return (env.ADMIN_SUBJECTS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(subject);}
export function hasAdminAccess(identity,env){return isAdmin(identity?.sub,env)||Array.isArray(identity?.permissions)&&identity.permissions.includes('read:activity');}
export function creditedSeconds(seconds,gap,age){return Math.min(600,seconds+Math.max(0,Math.min(30,gap,600-age)));}
export function createAdminHandler(database,env){
 return async(req,res,next)=>{
  const path=req.url?.split('?')[0];if(!['/api/admin','/api/activity'].includes(path))return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(path==='/api/admin'&&!hasAdminAccess(req.origenIdentity,env))return send(403,{error:'admin_required'});
  if(!database)return send(503,{error:'database_unavailable'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'request_too_large'});}
  let data;try{data=JSON.parse(raw);}catch{return send(400,{error:'invalid_request'});}
  if(path==='/api/admin'){
   if(data.action==='conversation-review'){
    try{return send(200,await reviewConversationFinding(database,req.origenIdentity.sub,data));}catch(error){if([400,404,409].includes(error.status))return send(error.status,{error:error.message});throw error;}
   }
   if(data.action==='access')return send(200,{admin:true});
   if(data.action==='conversation-quality'){
    try{return send(200,await adminConversationQuality(database,data));}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
   }
   if(data.action==='institution-report'){
    try{return send(200,await adminInstitutionReport(database,data));}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
   }
   if(data.action==='voice-quality'){
    if(data.days!==undefined&&![7,30,90].includes(data.days))return send(400,{error:'invalid_period'});
    try{return send(200,await adminVoiceQuality(database,data.days??30,new Date(),data));}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
   }
   if(['users','user-detail'].includes(data.action)){
    try{return send(200,await (data.action==='users'?adminUsers:adminUserDetail)(database,data));}
    catch(error){if([400,404].includes(error.status))return send(error.status,{error:error.message});throw error;}
   }
   if(data.action!=='overview')return send(400,{error:'invalid_action'});
   if(data.days!==undefined&&![7,30,90].includes(data.days))return send(400,{error:'invalid_period'});
   return send(200,await adminOverview(database,data.days??30));
  }
  if(!uuid.test(data.id||'')||!['login','voice_start','voice_heartbeat','voice_end'].includes(data.action))return send(400,{error:'invalid_activity'});
  if(data.action==='voice_start'&&!['profile','finance','admissions','planning','loans'].includes(data.topic))return send(400,{error:'invalid_topic'});
  const client=await database.connect();
  try{
   await client.query('BEGIN');
   await guardAccountTransaction(client,req.origenIdentity.sub);
   // Serialize a physical call, including duplicate start/end and concurrent heartbeats.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.id]);
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES($1) ON CONFLICT(auth0_subject) DO NOTHING',[req.origenIdentity.sub]);
   const owner=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[req.origenIdentity.sub])).rows[0].id;
   if(data.action==='login')await client.query('INSERT INTO origen_login_activity(id,account_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[data.id,owner]);
   else if(data.action==='voice_start')await client.query('INSERT INTO origen_voice_activity(id,account_id,topic) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[data.id,owner,data.topic]);
   else await client.query(`UPDATE origen_voice_activity SET seconds=least(600,seconds+greatest(0,least(30,extract(epoch FROM now()-last_seen_at),600-extract(epoch FROM last_seen_at-started_at)))),last_seen_at=now(),ended_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1 AND account_id=$2 AND ended_at IS NULL`,[data.id,owner,data.action==='voice_end']);
   await client.query('COMMIT');return send(204,{});
  }catch(error){await client.query('ROLLBACK');if(error.status===403)return send(403,{error:'account_closed'});throw error;}finally{client.release();}
 };
}
