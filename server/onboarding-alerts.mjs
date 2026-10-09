import {onboardingCohortSQL} from './admin-onboarding-metrics.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';
const rules=[
 ['connection','Voice connection problems',row=>Number(row.voice_starts)>0,row=>Number(row.connection_failed)>0],
 ['save','Profile saving problems',row=>Number(row.save_requests)>0,row=>Number(row.save_failed)>0],
 ['playback','Browser playback problems',row=>row.phase3===true&&Number(row.voice_starts)>0,row=>Number(row.playback_blocked)>0],
 ['handoff','Home handoff problems',row=>Number(row.handoff_requests)>0,row=>Number(row.transition_failed)>0],
 ['delivery','Reported delivery gaps',row=>row.delivery===true,row=>Number(row.delivery_gap)>0]
];
export function onboardingAlertReport(rows,settings){
 const checks=rules.map(([key,label,eligible,affected])=>{
  const selected=rows.filter(eligible),count=selected.filter(affected).length,total=selected.length;
  const ratePercent=total?count/total*100:null;
  return {key,label,eligible:total,affected:count,ratePercent,insufficient:total<settings.alertMinVisits,review:total>=settings.alertMinVisits&&count>=3&&ratePercent>=settings.alertRatePercent};
 });
 return {checks,reviewCount:checks.filter(check=>check.review).length,observedVisits:rows.length,recoveredDeliveryVisits:rows.filter(row=>Number(row.delivery_recovered)>0).length,thresholds:{minimumVisits:settings.alertMinVisits,minimumAffected:3,ratePercent:settings.alertRatePercent}};
}
export async function adminOnboardingAlerts(database,env={},now=new Date()){
 const settings=onboardingSettings(env),window={start:new Date(+now-86400000).toISOString(),end:now.toISOString()};
 let tracking;try{tracking=(await database.query("SELECT applied_at FROM origen_schema_migrations WHERE name='027_onboarding_events.sql'")).rows[0];}catch(error){if(error.code!=='42P01')throw error;}
 if(!tracking)return {available:false,window,generatedAt:window.end,...onboardingAlertReport([],settings)};
 const rows=(await database.query(onboardingCohortSQL,[window.start,window.end])).rows;
 return {available:true,window,generatedAt:window.end,...onboardingAlertReport(rows,settings)};
}
