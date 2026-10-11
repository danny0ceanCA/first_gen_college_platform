import {createHash,randomUUID} from 'node:crypto';
import {runAsAccount} from './account-isolation.mjs';
const areas=new Set(['account','privacy','family','history','voice','workspace','staff','institution']);
const kinds=new Set(['export_requested','export_prepared','access_denied']);
const routeArea={
 'api.account-data':'account','api.privacy':'privacy','api.family':'family','api.account-links':'family',
 'api.conversation-history':'history','api.conversation-summary':'history','api.profile-voice':'voice','api.ai':'voice',
 'api.finance-research':'voice','api.admissions-research':'voice','api.topic-notes':'workspace','api.plans':'workspace','api.workspace-sheets':'workspace',
 'api.admin':'staff','api.institutions':'institution','api.institution-inquiries.staff':'institution','api.institution-campaigns':'institution',
};
export async function recordPrivacyEvent(database,subject,kind,area){
 if(!database)throw new Error('privacy_audit_unavailable');
 if(typeof subject!=='string'||!subject.trim()||subject.length>255||!kinds.has(kind)||!areas.has(area))throw new Error('invalid_privacy_event');
 await database.query('INSERT INTO origen_privacy_events(id,actor_hash,kind,area) VALUES($1,$2,$3,$4)',[randomUUID(),createHash('sha256').update(subject).digest('hex'),kind,area]);
}
// Only verified identities and finite server routes/statuses enter this queue.
// It never receives request bodies, Authorization headers, IPs or error prose.
export function createPrivacyMonitor(database,write=()=>{}, {capacity=200}={}){
 const pending=new Set();let lastGap=-Infinity;
 const gap=code=>{if(Date.now()-lastGap<60000)return;lastGap=Date.now();try{write({event:'privacy_monitor_gap',code,level:'error'});}catch{}};
 return {
  observe({subject,endpoint,status}){
   const area=routeArea[endpoint];if(!database||!subject||!area||![403,404].includes(status))return;
   if(pending.size>=capacity){gap('queue_full');return;}
   const task=runAsAccount({sub:subject},()=>recordPrivacyEvent(database,subject,'access_denied',area)).catch(()=>gap('storage_unavailable')).finally(()=>pending.delete(task));pending.add(task);
  },
  async flush(){await Promise.all([...pending]);},
 };
}
export function detectPrivacyAlerts(rows,now=new Date()){
 const nowMs=now.getTime(),groups=new Map();
 for(const row of rows){
  const time=new Date(row.occurred_at).getTime();if(!/^[a-f0-9]{64}$/.test(row.actor_hash||'')||!Number.isFinite(time)||time>nowMs||time<=nowMs-900000)continue;
  const group=groups.get(row.actor_hash)||{exports:0,denials:0};
  if(row.kind==='export_requested')group.exports++;
  if(row.kind==='access_denied'&&time>nowMs-300000)group.denials++;
  groups.set(row.actor_hash,group);
 }
 const alerts=[];for(const [actorHash,value] of groups){
  if(value.exports>=3)alerts.push({code:'repeated_exports',actorHash,count:value.exports,windowMinutes:15});
  if(value.denials>=10)alerts.push({code:'repeated_access_denials',actorHash,count:value.denials,windowMinutes:5});
 }
 return alerts.sort((a,b)=>a.code.localeCompare(b.code)||a.actorHash.localeCompare(b.actorHash));
}
export async function privacyAlertReport(database,now=new Date()){
 const rows=(await database.query('SELECT actor_hash,kind,occurred_at FROM origen_privacy_events WHERE occurred_at>$1 AND occurred_at<=$2',[new Date(now.getTime()-900000).toISOString(),now.toISOString()])).rows;
 return {generatedAt:now.toISOString(),windowMinutes:15,events:rows.length,alerts:detectPrivacyAlerts(rows,now),limits:['Verified-account denials only; missing/invalid tokens remain in API logs.','An alert needs review; it is not proof of disclosure or abuse.','Buffered denial events can be lost on a crash; monitor privacy_monitor_gap logs.']};
}
export function createPrivacyAlertEmitter(write){
 const emitted=new Map();return report=>{
  const now=Date.parse(report.generatedAt);for(const [key,time] of emitted)if(now-time>=900000)emitted.delete(key);
  for(const alert of report.alerts){const key=alert.code+alert.actorHash;if(emitted.has(key))continue;if(emitted.size>=2000)break;emitted.set(key,now);
   // Operator reports contain pseudonymous correlation; ordinary log alerts do
   // not disclose even the hash. No message is sent to a user or third party.
   write({event:'privacy_alert',code:alert.code,level:'warn',sourceCount:alert.count});
  }
 };
}
export async function purgePrivacyEvents(database){if(database)await database.query("DELETE FROM origen_privacy_events WHERE occurred_at<now()-interval '90 days'");}
