import {randomUUID} from 'node:crypto';
export const families=Object.freeze(['api-errors','summary-persistence','permission-termination','telemetry-pipeline','expiry-deletion','privacy-boundary','release-regression']);
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error('invalid_monitor_snapshot');};
const number=n=>Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
export function evaluate(snapshot,now=Date.now()){
 exact(snapshot,['version','at','environment','rows','health','syntheticFailures','privacyEscapes','dropWindow','baseline']);
 if(snapshot.version!==1||!['production','staging','test','development'].includes(snapshot.environment)||!Number.isFinite(Date.parse(snapshot.at))||Math.abs(Date.parse(snapshot.at)-now)>90000||!Array.isArray(snapshot.rows)||snapshot.rows.length>32||!Array.isArray(snapshot.health)||snapshot.health.some(s=>!['canary_stale','expiry_stale','erasure_backlog','telemetry_unavailable'].includes(s))||!Number.isInteger(snapshot.syntheticFailures)||snapshot.syntheticFailures<0||snapshot.syntheticFailures>3||!Number.isInteger(snapshot.privacyEscapes)||snapshot.privacyEscapes<0||snapshot.privacyEscapes>1)throw Error('invalid_monitor_snapshot');
 const result=[],add=(row,family,facts,action='investigate')=>result.push({service:row.service,release:row.release,family,facts,coverage:row.coverage,action});
 const global={service:'origen-api',release:'unknown',coverage:'best_effort'},keys=new Set();
 for(const row of snapshot.rows){
  exact(row,['service','release','coverage','apiRequests','apiErrors','summaryFailures','hangupOldestMs','supervisorFailures']);
  const key=row.service+row.release;if(keys.has(key)||row.service!=='origen-api'||! /^(?:unknown|[a-f0-9]{40}|[a-f0-9]{64})$/.test(row.release)||!['complete','best_effort'].includes(row.coverage)||['apiRequests','apiErrors','summaryFailures','hangupOldestMs','supervisorFailures'].some(k=>!number(row[k]))||row.apiErrors>row.apiRequests)throw Error('invalid_monitor_snapshot');keys.add(key);
  if(row.apiRequests>=20&&row.apiErrors/row.apiRequests>0.05)add(row,'api-errors',{requests:row.apiRequests,errors:row.apiErrors});
  if(row.summaryFailures>=3)add(row,'summary-persistence',{failures:row.summaryFailures});
  if(row.hangupOldestMs>30000||row.supervisorFailures>=3)add(row,'permission-termination',{oldestMs:Math.round(row.hangupOldestMs),failures:row.supervisorFailures},'priority_review');
 }
 if(snapshot.syntheticFailures>=3&&!result.some(r=>r.family==='api-errors'))add(global,'api-errors',{syntheticFailures:snapshot.syntheticFailures});
 let drops=false;if(snapshot.dropWindow!==null){exact(snapshot.dropWindow,['durationMs','accepted','dropped']);const w=snapshot.dropWindow;if(Object.values(w).some(n=>!number(n)))throw Error('invalid_monitor_snapshot');drops=w.durationMs>=300000&&w.accepted+w.dropped>0&&w.dropped/(w.accepted+w.dropped)>0.01;}
 if(snapshot.health.some(s=>['canary_stale','telemetry_unavailable'].includes(s))||drops)add(global,'telemetry-pipeline',{canaryStale:snapshot.health.includes('canary_stale'),unavailable:snapshot.health.includes('telemetry_unavailable'),dropThreshold:drops});
 if(snapshot.health.some(s=>['expiry_stale','erasure_backlog'].includes(s)))add(global,'expiry-deletion',{expiryStale:snapshot.health.includes('expiry_stale'),erasureBacklog:snapshot.health.includes('erasure_backlog')},'restrict_investigations');
 if(snapshot.privacyEscapes)add(global,'privacy-boundary',{escapes:1},'disable_affected_path');
 if(snapshot.baseline!==null){const b=snapshot.baseline;exact(b,['release','requests','errors']);if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(b.release)||!number(b.requests)||!number(b.errors)||b.errors>b.requests)throw Error('invalid_monitor_snapshot');
  for(const row of snapshot.rows)if(row.release!=='unknown'&&row.release!==b.release&&row.coverage==='complete'&&row.apiRequests>=100&&b.requests>=100){const p=row.apiErrors/row.apiRequests,q=b.errors/b.requests,se=Math.sqrt(p*(1-p)/row.apiRequests+q*(1-q)/b.requests);if(p>0.05&&p-q>Math.max(0.02,3*se))add(row,'release-regression',{requests:row.apiRequests,errors:row.apiErrors,baselineRequests:b.requests,baselineErrors:b.errors},'review_rollback');}
 }
 return result;
}
// Shadow mode is deliberately unconditional. This module has no pager, webhook or credentials.
export function shadowTick(snapshot,state={version:1,incidents:[],since:null,last:null,observations:0},now=Date.now()){
 const candidates=evaluate(snapshot,now);exact(state,['version','incidents','since','last','observations']);
 if(state.version!==1||!Array.isArray(state.incidents)||state.incidents.length>224||!Number.isSafeInteger(state.observations)||state.observations<0||state.last!==null&&(!Number.isFinite(state.last)||state.last>now)||state.since!==null&&(!Number.isFinite(state.since)||state.since>now))throw Error('invalid_monitor_state');
 const keyPattern=new RegExp(`^(production|staging|test|development)\\|origen-api\\|(unknown|[a-f0-9]{40}|[a-f0-9]{64})\\|(${families.join('|')})$`);
 for(const i of state.incidents){exact(i,['id','key','openedAt']);if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(i.id)||!keyPattern.test(i.key)||!number(i.openedAt)||i.openedAt>now)throw Error('invalid_monitor_state');}
 const at=Date.parse(snapshot.at);if(state.last!==null&&at<=state.last)throw Error('stale_monitor_snapshot');
 const uninterrupted=state.last!==null&&at-state.last<=120000;
 const since=uninterrupted?state.since:at,observations=uninterrupted?state.observations+1:1;
 const old=new Map(state.incidents.filter(i=>now-i.openedAt<90*86400000).map(i=>[i.key,i])),active=[],alerts=[];
 for(const c of candidates){const key=[snapshot.environment,c.service,c.release,c.family].join('|'),previous=old.get(key),incident=previous??{id:randomUUID(),key,openedAt:now};active.push(incident);old.delete(key);if(!previous)alerts.push({version:1,mode:'shadow',incidentId:incident.id,environment:snapshot.environment,...c});}
 return {state:{version:1,incidents:active,since,last:at,observations},alerts,resolved:[...old.values()].map(i=>i.id),shadowReviewDue:at-since>=7*86400000&&observations>=10080};
}
