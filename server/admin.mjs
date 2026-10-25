import {reviewConversationFinding} from './conversation-reviews.mjs';
import {adminOverview} from './admin-overview.mjs';
import {adminUsers,adminUserDetail} from './admin-users.mjs';
import {adminUserHistory} from './admin-user-history.mjs';
import {adminEngagement} from './admin-engagement.mjs';
import {adminProgress} from './admin-progress.mjs';
import {adminReportSnapshots} from './admin-report-snapshots.mjs';
import {adminUserConversations} from './admin-user-conversations.mjs';
import {adminReviewQueue,adminReviewHistory,adminReviewEvidence,reviewQueueItem} from './admin-review-queue.mjs';
import {adminOnboardingTimeline,adminOnboardingAttempt} from './admin-onboarding.mjs';
import {adminOnboardingMetrics} from './admin-onboarding-metrics.mjs';
import {adminOnboardingAlerts} from './onboarding-alerts.mjs';
import {adminVoiceQuality} from './voice-quality.mjs';
import {adminConversationQuality} from './conversation-quality-store.mjs';
import {adminInstitutionReport} from './admin-institutions.mjs';
import {adminOrganizationOverview} from './admin-organization-overview.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {ADMIN_ACTIONS,adminCapabilities,requireStaffAccess,staffPermissions} from './staff-access.mjs';
import {runAsAnalytics} from './account-isolation.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAdmin(subject,env){return (env.ADMIN_SUBJECTS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(subject);}
export function hasAdminAccess(identity,env){return adminCapabilities(identity,env).admin;}
export function creditedSeconds(seconds,gap,age){return Math.min(600,seconds+Math.max(0,Math.min(30,gap,600-age)));}
export function createAdminHandler(database,env){
 return async(req,res,next)=>{
  const path=req.url?.split('?')[0];if(!['/api/admin','/api/activity'].includes(path))return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(path==='/api/admin'&&!hasAdminAccess(req.origenIdentity,env))return send(403,{error:'admin_required'});
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!database)return send(503,{error:'database_unavailable'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'request_too_large'});}
  let data;try{data=JSON.parse(raw);}catch{return send(400,{error:'invalid_request'});}
  if(!data||typeof data!=='object'||Array.isArray(data))return send(400,{error:'invalid_request'});
  if(path==='/api/admin'){
   if(data.action==='access')return send(200,adminCapabilities(req.origenIdentity,env));
   const permission=Object.hasOwn(ADMIN_ACTIONS,data.action)?ADMIN_ACTIONS[data.action]:null;
   if(!permission)return send(400,{error:'invalid_action'});
   try{await requireStaffAccess(database,req.origenIdentity,{scope:'admin',action:data.action,permission,env,fresh:permission.startsWith('write:'),target:data.accountId||data.id||data.organizationId});}
   catch(error){return send(error.status||503,{error:error.status?error.message:'staff_access_unavailable'});}
   const execute=async()=>{
   if(data.action==='organization-overview'){
    try{return send(200,await adminOrganizationOverview(database,data));}
    catch(error){const known=[400,404].includes(error.status);return send(known?error.status:503,{error:known?error.message:'organization_overview_unavailable'});}
   }
   if(['progress-report','institution-snapshot-save','institution-snapshots','institution-snapshot'].includes(data.action)){
    if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
    try{return send(200,await (data.action==='progress-report'?adminProgress(database,data,new Date(),env):adminReportSnapshots(database,req.origenIdentity.sub,data)));}
    catch(error){const known=[400,403,404,409,410].includes(error.status);return send(known?error.status:503,{error:known?error.message:'reporting_unavailable'});}
   }
   if(['review-queue','review-history','review-evidence','review-decision'].includes(data.action)){
    if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
    try{return send(200,await (data.action==='review-decision'?reviewQueueItem(database,req.origenIdentity.sub,data,new Date(),env):data.action==='review-history'?adminReviewHistory(database,data):data.action==='review-evidence'?adminReviewEvidence(database,data,new Date(),env):adminReviewQueue(database,data,new Date(),env)));}
    catch(error){const known=[400,404,409].includes(error.status);return send(known?error.status:503,{error:known?error.message:'review_queue_unavailable'});}
   }
   if(data.action==='conversation-review'){
    try{return send(200,await reviewConversationFinding(database,req.origenIdentity.sub,data));}catch(error){if([400,404,409].includes(error.status))return send(error.status,{error:error.message});throw error;}
   }
   if(data.action==='user-conversations'){
    try{return send(200,await adminUserConversations(database,data,new Date(),env));}
    catch(error){return send([400,404].includes(error.status)?error.status:503,{error:[400,404].includes(error.status)?error.message:'conversations_unavailable'});}
   }
   if(data.action==='engagement'){
    const adminSubjects=[...(env.ADMIN_SUBJECTS||'').split(',').map(value=>value.trim()).filter(Boolean),req.origenIdentity.sub];
    try{return send(200,await adminEngagement(database,data,new Date(),env,adminSubjects));}
    catch(error){return send(error.status===400?400:503,{error:error.status===400?error.message:'engagement_unavailable'});}
   }
   if(data.action==='user-history'){
    try{return send(200,await adminUserHistory(database,data,new Date(),env));}
    catch(error){return send([400,404].includes(error.status)?error.status:503,{error:[400,404].includes(error.status)?error.message:'user_history_unavailable'});}
   }
   if(data.action==='onboarding-metrics'){
    try{return send(200,await adminOnboardingMetrics(database,data,new Date(),env));}
    catch(error){return send(error.status===400?400:503,{error:error.status===400?error.message:'onboarding_metrics_unavailable'});}
   }
   if(data.action==='onboarding-alerts'){
    try{return send(200,await adminOnboardingAlerts(database,env));}catch{return send(503,{error:'onboarding_alerts_unavailable'});}
   }
   if(['onboarding-timeline','onboarding-attempt'].includes(data.action)){
    try{return send(200,await (data.action==='onboarding-timeline'?adminOnboardingTimeline:adminOnboardingAttempt)(database,data,new Date(),env));}
    catch(error){return send([400,404].includes(error.status)?error.status:503,{error:[400,404].includes(error.status)?error.message:'onboarding_history_unavailable'});}
   }
   if(data.action==='conversation-quality'){
    try{return send(200,await adminConversationQuality(database,data));}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
   }
   if(data.action==='institution-report'){
    if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
    try{return send(200,await adminInstitutionReport(database,data));}catch(error){return send(error.status===400?400:503,{error:error.status===400?error.message:'reporting_unavailable'});}
   }
   if(data.action==='voice-quality'){
    if(data.days!==undefined&&![7,30,90].includes(data.days))return send(400,{error:'invalid_period'});
    try{return send(200,await adminVoiceQuality(database,data.days??30,new Date(),data));}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
   }
   if(['users','user-detail'].includes(data.action)){
    const adminSubjects=[...(env.ADMIN_SUBJECTS||'').split(',').map(value=>value.trim()).filter(Boolean),req.origenIdentity.sub];
    try{return send(200,await (data.action==='users'?adminUsers:adminUserDetail)(database,data,new Date(),adminSubjects));}
    catch(error){if([400,404].includes(error.status))return send(error.status,{error:error.message});throw error;}
   }
   if(data.action!=='overview')return send(400,{error:'invalid_action'});
   if(data.days!==undefined&&![7,30,90].includes(data.days))return send(400,{error:'invalid_period'});
   return send(200,await adminOverview(database,data.days??30,new Date(),{includePeople:staffPermissions(req.origenIdentity,env).includes('read:users')}));
   };
   return database.isolated?runAsAnalytics(execute):execute();
  }
  if(!uuid.test(data.id||'')||!['login','voice_start','voice_heartbeat','voice_end'].includes(data.action))return send(400,{error:'invalid_activity'});
  if(data.action==='voice_start'&&!['profile','finance','admissions','planning','loans'].includes(data.topic))return send(400,{error:'invalid_topic'});
  if(data.action==='voice_start'&&data.segmentId!=null&&(typeof data.segmentId!=='string'||!uuid.test(data.segmentId)))return send(400,{error:'invalid_activity'});
  const client=await database.connect();
  try{
   await client.query('BEGIN');
   await guardAccountTransaction(client,req.origenIdentity.sub);
   // Serialize a physical call, including duplicate start/end and concurrent heartbeats.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.id]);
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES($1) ON CONFLICT(auth0_subject) DO NOTHING',[req.origenIdentity.sub]);
   const owner=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[req.origenIdentity.sub])).rows[0].id;
   if(data.action==='login')await client.query('INSERT INTO origen_login_activity(id,account_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[data.id,owner]);
   else if(data.action==='voice_start')await client.query('INSERT INTO origen_voice_activity(id,account_id,topic,guidance_segment_id) VALUES($1,$2,$3,(SELECT id FROM origen_guidance_segments WHERE account_id=$2 AND id=$4)) ON CONFLICT(id) DO NOTHING',[data.id,owner,data.topic,data.segmentId??null]);
   else await client.query(`UPDATE origen_voice_activity SET seconds=least(600,seconds+greatest(0,least(30,extract(epoch FROM now()-last_seen_at),600-extract(epoch FROM last_seen_at-started_at)))),last_seen_at=now(),ended_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1 AND account_id=$2 AND ended_at IS NULL`,[data.id,owner,data.action==='voice_end']);
   await client.query('COMMIT');return send(204,{});
  }catch(error){await client.query('ROLLBACK');if(error.status===403)return send(403,{error:'account_closed'});throw error;}finally{client.release();}
 };
}
