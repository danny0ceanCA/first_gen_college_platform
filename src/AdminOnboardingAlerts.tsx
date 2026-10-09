import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
type Report={available:boolean;window:{start:string;end:string};checks:{key:string;label:string;eligible:number;affected:number;ratePercent:number|null;insufficient:boolean;review:boolean}[];reviewCount:number;observedVisits:number;recoveredDeliveryVisits:number;thresholds:{minimumVisits:number;minimumAffected:number;ratePercent:number}};
const number=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:1});
export default function AdminOnboardingAlerts({revision,onDenied}:{revision:number;onDenied:()=>void}){
 const {getAccessTokenSilently}=useAuth0();const [data,setData]=useState<Report>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const abort=new AbortController();setData(undefined);setError('');void(async()=>{
  try{const token=await getAccessTokenSilently();if(abort.signal.aborted)return;const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'onboarding-alerts'}),signal:abort.signal});if(abort.signal.aborted)return;
   if(!response.ok){if([401,403].includes(response.status))onDenied();throw new Error('Onboarding review flags could not load. Please try again.');}
   const next=await response.json();if(!abort.signal.aborted)setData(next);
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Review flags unavailable.');}
 })();return()=>abort.abort();},[revision,retry]);
 return <section className="admin-panel admin-onboarding-alerts" aria-labelledby="onboarding-review-title"><div className="admin-panel-heading"><div><h3 id="onboarding-review-title">Onboarding review flags</h3><p>Visits beginning in the last 24 hours · independent of the reporting-period selector</p></div></div>
 {error?<div className="admin-error" role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry review flags</button></div>:!data?<p className="admin-empty" role="status">Checking recent onboarding signals…</p>:!data.available?<p className="admin-empty">Review flags require deployed onboarding capture.</p>:<>
 <p className="admin-funnel-note">{data.reviewCount?`${number(data.reviewCount)} ${data.reviewCount===1?'category needs':'categories need'} review. Open an account’s onboarding history to investigate recorded events.`:'No recorded issue rate crossed the review threshold. This does not establish that all visits succeeded.'} {number(data.recoveredDeliveryVisits)} visits reported recovering a delivery retry.</p>
 <ul className="admin-onboarding-review-list">{data.checks.map(check=><li key={check.key} className={check.review?'needs-review':''}><div><strong>{check.label}</strong><span>{number(check.affected)} affected / {number(check.eligible)} eligible visits · {check.ratePercent===null?'Rate unavailable':`${number(check.ratePercent)}%`}</span></div><span className="admin-count">{check.review?'Review':check.insufficient?'Small sample':'Below threshold'}</span></li>)}</ul>
 <details className="admin-cohort-definitions"><summary>Review thresholds and limitations</summary><p>Review requires at least {number(data.thresholds.minimumVisits)} eligible visits, {number(data.thresholds.minimumAffected)} affected visits and a recorded issue rate of {number(data.thresholds.ratePercent)}% or higher. Thresholds are configured on the backend. Flags are recalculated when refreshed; no email or external notification is sent.</p><p>Voice, save and home flags require their respective start/request signals. Playback requires phase 3 capture; delivery gaps require recovery-capable capture. Retried events count once per visit. Delivery gaps describe a client’s report of dropped diagnostics, not proof of abandoned onboarding. Silent/offline clients and expired records cannot establish a rate.</p><p>Window: {new Date(data.window.start).toLocaleString()}–{new Date(data.window.end).toLocaleString()}. These are operational review prompts, not research findings or comparisons between user groups.</p></details>
 </>}
 </section>;
}
