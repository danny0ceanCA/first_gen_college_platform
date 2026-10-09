import {adminWindow} from './admin-overview.mjs';
import {onboardingUUID,sanitizeOnboardingMetadata} from './onboarding-events.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';
const pageSize=5,eventPageSize=50;
function invalid(){throw Object.assign(new Error('invalid_onboarding_filter'),{status:400});}
function filters(input,now){
 const {days=30,page=1}=input;
 if(!onboardingUUID(input.id)||![7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>10000)invalid();
 return {id:input.id,page,window:adminWindow(days,now)};
}
async function account(database,id){
 const row=(await database.query('SELECT id,created_at FROM origen_accounts WHERE id=$1',[id])).rows[0];
 if(!row)throw Object.assign(new Error('user_not_found'),{status:404});
 return row;
}
async function coverage(database,user,env){
 let tracking;
 try{tracking=(await database.query("SELECT applied_at FROM origen_schema_migrations WHERE name='027_onboarding_events.sql'")).rows[0];}
 catch(error){if(error.code!=='42P01')throw error;}
 const measuredSince=tracking?.applied_at??null;
 return {available:!!measuredSince,measuredSince,retentionDays:onboardingSettings(env).retentionDays,olderAccount:!!measuredSince&&+new Date(user.created_at)<+new Date(measuredSince)};
}
// The period selects attempts by receipt activity. Events show the full retained
// attempt, even if it began before the selected period. No content is read.
export async function adminOnboardingTimeline(database,input,now=new Date(),env={}){
 const f=filters(input,now),user=await account(database,f.id),tracking=await coverage(database,user,env);
 if(!tracking.available)return {coverage:tracking,attempts:[],total:0,page:f.page,pageSize,window:f.window};
 const params=[f.id,f.window.start,f.window.end];
 const where='account_id=$1 AND last_received_at>=$2 AND started_at<$3';
 const [count,rows]=await Promise.all([
  database.query(`SELECT count(*) AS total FROM origen_onboarding_attempts WHERE ${where}`,params),
  database.query(`SELECT id,started_at,last_received_at,resumed,saved_at FROM origen_onboarding_attempts WHERE ${where} ORDER BY started_at DESC,id DESC LIMIT 5 OFFSET $4`,[...params,(f.page-1)*pageSize])
 ]);
 const attempts=await Promise.all(rows.rows.map(async attempt=>{
  const groups=(await database.query(`SELECT name,producer,count(*) AS count FROM origen_onboarding_events WHERE account_id=$1 AND attempt_id=$2 AND received_at<$3 GROUP BY name,producer`,[f.id,attempt.id,f.window.end])).rows;
  const seen=(name,producer='client')=>groups.some(row=>row.name===name&&row.producer===producer);
  return {...attempt,eventCount:groups.reduce((sum,row)=>sum+Number(row.count),0),homeReached:seen('home_reached'),logoutSelected:seen('logout_selected'),saveFailed:seen('save_failed'),voiceFailed:seen('voice_connection_failed'),clientSaveSucceeded:seen('save_succeeded')};
 }));
 return {coverage:tracking,attempts,total:Number(count.rows[0].total),page:f.page,pageSize,window:f.window};
}
export async function adminOnboardingAttempt(database,input,now=new Date()){
 const f=filters(input,now);
 if(!onboardingUUID(input.attemptId))invalid();
 await account(database,f.id);
 const attempt=(await database.query(`SELECT id FROM origen_onboarding_attempts WHERE account_id=$1 AND id=$2 AND last_received_at>=$3 AND started_at<$4`,[f.id,input.attemptId,f.window.start,f.window.end])).rows[0];
 if(!attempt)throw Object.assign(new Error('attempt_not_found'),{status:404});
 const params=[f.id,input.attemptId,f.window.end];
 const [count,events]=await Promise.all([
  database.query('SELECT count(*) AS total FROM origen_onboarding_events WHERE account_id=$1 AND attempt_id=$2 AND received_at<$3',params),
  database.query(`SELECT producer,sequence,name,occurred_at,received_at,metadata FROM origen_onboarding_events WHERE account_id=$1 AND attempt_id=$2 AND received_at<$3 ORDER BY occurred_at ASC,received_at ASC,producer ASC,sequence ASC LIMIT 50 OFFSET $4`,[...params,(f.page-1)*eventPageSize])
 ]);
 return {attemptId:input.attemptId,events:events.rows.map(event=>({...event,metadata:sanitizeOnboardingMetadata(event.metadata)})),total:Number(count.rows[0].total),page:f.page,pageSize:eventPageSize,window:f.window};
}
