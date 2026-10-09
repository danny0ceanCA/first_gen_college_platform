import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import AdminOnboardingAlerts from './AdminOnboardingAlerts';

type Counts={attempts:number;saved:number;home:number;issues:number;mature:number;savedWithin24h:number};
type Report={coverage:{available:boolean;measuredSince:string|null;retentionDays:number};generatedAt:string;totals:Counts&{users:number;savedUsers:number;returningUsers:number;returningSavedUsers:number;voiceVisits:number;connectedVisits:number;phase3VoiceVisits:number;firstAudioVisits:number;nativeAcknowledged:number;saveRecoveryVisits:number;setupChangeVisits:number};issues:Record<string,number>;timings:{medianSaveMs:number|null;saveSamples:number;medianFirstAudioMs:number|null;audioSamples:number};segments:(Counts&{language:string;method:string})[];series:(Counts&{date:string;tracked:boolean})[]};
const number=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});
const rate=(n:number,d:number)=>d?`${number(n/d*100)}%`:'—';
const duration=(ms:number|null)=>ms===null?'—':ms>=60000?`${number(ms/60000)} min`:`${number(ms/1000)} sec`;
const language=(value:string)=>value==='en'?'English':value==='es'?'Spanish':'Not recorded';
const method=(value:string)=>({voice:'Voice',manual:'Manual',name:'Name entry'}[value]||'Not recorded');
const issueLabels:Record<string,string>={microphone_denied:'Microphone permission denied',connection_failed:'Microphone or connection failure',playback_blocked:'Browser playback blocked',transcription_timeout:'Transcription timed out',validation_failed:'Required information missing',save_failed:'Profile save failed',confirmation_interrupted:'Save confirmation interrupted',transition_failed:'Home transition or native handoff failed'};
export default function AdminOnboardingMetrics({days,revision,onDenied}:{days:number;revision:number;onDenied:()=>void}){
 const {getAccessTokenSilently}=useAuth0();const [data,setData]=useState<Report>(),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState<string>();
 useEffect(()=>{const controller=new AbortController();setData(undefined);setError('');setSelected(undefined);void(async()=>{
  try{const token=await getAccessTokenSilently();if(controller.signal.aborted)return;const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'onboarding-metrics',days}),signal:controller.signal});if(controller.signal.aborted)return;
   if(!response.ok){if([401,403].includes(response.status))onDenied();throw new Error('Onboarding insights could not load. Please try again.');}
   const next=await response.json();if(!controller.signal.aborted)setData(next);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Onboarding insights could not load.');}
 })();return()=>controller.abort();},[days,revision,retry]);
 const t=data?.totals,chosen=data?.series?.find(row=>row.date===selected),max=Math.max(1,...(data?.series?.map(row=>row.attempts)||[]));
 return <section className="admin-onboarding-insights" aria-labelledby="onboarding-insights-title">
 <div className="admin-report-heading"><div><h2 id="onboarding-insights-title">Onboarding insights</h2><p>Visits that began in the selected {days} days · all accounts, independent of directory filters</p></div></div>
 <AdminOnboardingAlerts revision={revision} onDenied={onDenied}/>
 {error?<div className="admin-error" role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>Retry onboarding insights</button></div>:!data?<p className="admin-empty" role="status">Loading onboarding insights…</p>:!data.coverage.available?<div className="admin-panel admin-empty">Detailed onboarding capture is not available yet. Insights will appear after event tracking is deployed.</div>:<>
 <div className="admin-stats admin-quality-stats">
 {[
  {label:'Users who opened setup',value:number(t!.users),note:`${number(t!.attempts)} recorded visits · retries count as visits`},
  {label:'Users with a confirmed save',value:rate(t!.savedUsers,t!.users),note:`${number(t!.savedUsers)} of ${number(t!.users)} users · server confirmation`},
  {label:'Returning users who saved',value:number(t!.returningSavedUsers),note:`Of ${number(t!.returningUsers)} users with a recorded returning visit`},
  {label:'Visits saved within 24 hours',value:rate(t!.savedWithin24h,t!.mature),note:`${number(t!.savedWithin24h)} of ${number(t!.mature)} visits old enough to measure`}
 ].map(card=><article key={card.label}><div className="admin-stat-heading">{card.label}</div><strong>{card.value}</strong><p>{card.note}</p></article>)}
 </div>
 <p className="admin-quality-caption">{number(t!.attempts-t!.saved)} visits have no server-confirmed save recorded. Their outcome is unknown; this is not an abandonment count. Recent visits are excluded only from the 24-hour measure.</p>
 {!t!.attempts&&<p className="admin-empty">No retained visits began in this reporting period.</p>}
 <div className="admin-chart-grid">
 <section className="admin-panel"><div className="admin-panel-heading"><div><h3>Progress and timing</h3><p>Observed outcomes for these visits</p></div></div><dl className="admin-quality-metrics">
 {[
  ['Web home arrival',`${number(t!.home)} visits`],['Native host acknowledgement',`${number(t!.nativeAcknowledged)} visits`],
  ['Voice connected',`${number(t!.connectedVisits)} of ${number(t!.voiceVisits)} voice visits`],
  ['Save after a failed save',`${number(t!.saveRecoveryVisits)} visits`],['Setup or language changed',`${number(t!.setupChangeVisits)} visits`],
  ['Median time to save',`${duration(data.timings.medianSaveMs)} · ${number(data.timings.saveSamples)} saves`],
  ['Median time to first audio',`${duration(data.timings.medianFirstAudioMs)} · ${number(data.timings.audioSamples)} visits`]
 ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
 </dl><p className="admin-funnel-note">First audio was observed in {number(t!.firstAudioVisits)} of {number(t!.phase3VoiceVisits)} voice visits using phase 3 capture. Missing audio events do not prove silence. Native acknowledgement does not confirm a home render.</p></section>
 <section className="admin-panel"><div className="admin-panel-heading"><div><h3>Recorded friction</h3><p>Visits with each signal · a visit may appear in several categories</p></div><span className="admin-count">{number(t!.issues)} visits</span></div><dl className="admin-quality-metrics">{Object.entries(issueLabels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{number(data.issues[key]||0)}</dd></div>)}</dl><p className="admin-funnel-note">Interruptions may be normal conversation. These signals identify visits to review; they do not establish why a person left.</p></section>
 </div>
 <section className="admin-panel"><div className="admin-panel-heading"><div><h3>Language and setup method</h3><p>Initial recorded choice for each visit · switches keep the same visit</p></div></div>{data.segments.length?<div className="admin-table"><table><caption className="admin-sr-only">Onboarding visit cohorts by initial language and setup method</caption><thead><tr><th>Language</th><th>Setup</th><th>Visits</th><th>Confirmed saves</th><th>Save rate</th><th>With friction</th></tr></thead><tbody>{data.segments.map(row=><tr key={row.language+row.method}><td>{language(row.language)}</td><td>{method(row.method)}</td><td>{number(row.attempts)}</td><td>{number(row.saved)}</td><td>{rate(row.saved,row.attempts)}</td><td>{number(row.issues)}</td></tr>)}</tbody></table></div>:<p className="admin-empty">No visit cohorts recorded.</p>}<p className="admin-funnel-note">These are visit rates, not unique-user rates. Small samples and recent visits can shift them substantially; a difference does not establish a cause.</p></section>
 <section className="admin-panel"><div className="admin-panel-heading"><div><h3>Visits by start date</h3><p>UTC date of first server receipt · saved by this report’s cutoff</p></div></div>
 <div className="admin-cohort-chart" aria-label="Onboarding visits by UTC start date">{data.series.map(row=><button key={row.date} className={`${selected===row.date?'selected ':''}${row.tracked?'':'untracked'}`} aria-pressed={selected===row.date} aria-label={row.tracked?`${row.date}: ${number(row.attempts)} visits, ${number(row.saved)} saved`:`${row.date}: capture unavailable`} onClick={()=>setSelected(row.date)}><span style={{height:`${row.attempts/max*100}%`}}><span style={{height:`${row.attempts?row.saved/row.attempts*100:0}%`}}/></span></button>)}</div>
 <div className="admin-cohort-dates"><span>{data.series[0]?.date}</span><span>{data.series.at(-1)?.date}</span></div>
 <p className="admin-chart-detail" role="status">{chosen?chosen.tracked?`${chosen.date} UTC: ${number(chosen.attempts)} visits · ${number(chosen.saved)} confirmed saves · ${number(chosen.issues)} with friction · ${rate(chosen.savedWithin24h,chosen.mature)} saved within 24 hours (${number(chosen.mature)} eligible).`:`${chosen.date} UTC: detailed capture was unavailable. No visit count can be established.`:'Select a date to inspect its visits. Pale bars show all visits; terracotta shows confirmed saves. Hatched dates predate capture.'}</p>
 <details className="admin-cohort-definitions"><summary>How these measures work</summary>
 <p>A visit is one retained onboarding attempt whose first server receipt falls within the period. Later events received before the report cutoff stay with that visit. The user counts deduplicate accounts across those visits. The older registration funnel above uses a different cohort.</p>
 <p>A returning visit was marked resumed when an earlier retained visit existed. It does not prove the user was previously unsuccessful. Confirmed saves come from the profile transaction; browser save messages alone do not qualify.</p>
 <p>The 24-hour measure includes only visits at least 24 hours old. Save timing uses server timestamps within one visit. First-audio timing uses the first observed voice response in a visit and its device clock; it cannot establish that the person heard it.</p>
 <p>Capture began {new Date(data.coverage.measuredSince!).toLocaleString()}. Attempts inactive for {data.coverage.retentionDays} days are removed. Older clients, delivery failures and expired visits can leave gaps; history is not backfilled. New events from a still-open visit or delayed delivery can update recent cohorts.</p>
 </details></section>
 </>}
 </section>;
}
