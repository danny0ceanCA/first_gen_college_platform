import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
type Rate={numerator:number;denominator:number;percent:number|null};
type Report={generatedAt:string;window:{start:string;end:string;days:number};collectionEnabled:boolean;coverage:{reportsSince:string|null;promptsSince:string|null;retentionDays:number};feedback:{submissions:number;accounts:number;answered:number;helpful:number;partly:number;notYet:number;declined:number;unknown:number;unlinked:number;otherDefinitions:number;opened:number;answeredPrompts:number;declinedPrompts:number;withoutAnswer:number;helpfulness:Rate;participation:Rate};milestones:{value:string;submissions:number;accounts:number}[];milestoneAccounts:number;definitions:Record<string,string>};
const n=(v:number)=>v.toLocaleString(),rate=(r:Rate)=>r.percent===null?'—':`${r.percent.toLocaleString()}%`;
const milestones=[['counselor-contacted','Contacted a counselor'],['application-started','Started an application'],['application-submitted','Submitted an application'],['aid-offer-reviewed','Reviewed an aid offer']];
export default function AdminProgress({days,revision,onDenied}:{days:number;revision:number;onDenied:()=>void}){
 const {getAccessTokenSilently}=useAuth0(),[data,setData]=useState<Report>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();setData(undefined);setError('');void (async()=>{
  const token=await getAccessTokenSilently();if(c.signal.aborted)return;
  const r=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'progress-report',days}),signal:c.signal});
  if(c.signal.aborted)return;
  if([401,403].includes(r.status)){onDenied();return;}if(!r.ok)throw Error('Reported progress could not load. Please try again.');
  const report=await r.json();if(!c.signal.aborted)setData(report);
 })().catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[days,revision,retry]);
 if(error)return <div className="admin-error" role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>Retry progress report</button></div>;
 if(!data)return <div className="admin-empty" role="status">Loading reported progress…</div>;
 const f=data.feedback;
 return <div className="admin-progress">
 <div className="admin-panel admin-progress-intro"><div className="admin-panel-heading"><div><h2>What people say helped</h2><p>Optional feedback and steps people report taking</p></div><span className="admin-count">Internal only</span></div><p>These measures describe reported experience. They do not verify learning, admission, enrollment, or Origen’s effect on those outcomes.</p>
 {!data.collectionEnabled&&<p className="admin-funnel-note">Collection is currently disabled on the server. Retained historical reports may still appear.</p>}</div>
 <div className="admin-stats admin-progress-stats">
 <article><div className="admin-stat-heading">Reported helpfulness</div><strong>{rate(f.helpfulness)}</strong><p>{n(f.helpful)} helpful / {n(f.answered)} answered responses</p><span className="admin-comparison">{f.answered?'Partly and Not yet stay in the denominator':'No answered feedback in this period'}</span></article>
 <article><div className="admin-stat-heading">Feedback participation</div><strong>{rate(f.participation)}</strong><p>{n(f.answeredPrompts)} answered / {n(f.opened)} recorded opportunities</p><span className="admin-comparison">{f.opened?'Openings of the optional feedback panel':'No recorded opportunities in this period'}</span></article>
 <article><div className="admin-stat-heading">Accounts sharing progress</div><strong>{n(data.milestoneAccounts)}</strong><p>Distinct accounts reporting at least one step</p><span className="admin-comparison">Self-reported · not school verified</span></article>
 </div>
 <div className="admin-chart-grid">
 <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Feedback responses</h2><p>{n(f.submissions)} submissions from {n(f.accounts)} accounts</p></div></div>
 <ul className="admin-progress-breakdown">{[['Helpful',f.helpful],['Partly',f.partly],['Not yet',f.notYet],['Prefer not to answer',f.declined],['Unknown response',f.unknown]].map(([label,value])=><li key={label}><span>{label}</span><strong>{n(Number(value))}</strong></li>)}</ul><p className="admin-funnel-note">{n(f.unlinked)} submissions have no linked opening record. {f.otherDefinitions>0&&`${n(f.otherDefinitions)} submissions use other measurement versions and are excluded.`} Repeated feedback is possible.</p>
 </section>
 <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Recorded opportunities</h2><p>Openings received in this period</p></div></div>
 <ul className="admin-progress-breakdown"><li><span>Answered</span><strong>{n(f.answeredPrompts)}</strong></li><li><span>Chose not to answer</span><strong>{n(f.declinedPrompts)}</strong></li><li><span>No answer recorded</span><strong>{n(f.withoutAnswer)}</strong></li></ul><p className="admin-funnel-note">No answer is not negative feedback. Opportunities are panel openings, not unique people. Collection gaps and older clients can leave openings unrecorded.</p>
 </section></div>
 <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Steps people reported</h2><p>Grouped by when Origen received the report</p></div></div><div className="admin-table" tabIndex={0} role="region" aria-label="Reported milestones"><table><caption className="admin-sr-only">Self-reported milestones in the selected period</caption><thead><tr><th>Reported step</th><th>Accounts</th><th>Submissions</th></tr></thead><tbody>{milestones.map(([id,label])=>{const row=data.milestones.find(m=>m.value===id);return <tr key={id}><td>{label}</td><td>{n(row?.accounts??0)}</td><td>{n(row?.submissions??0)}</td></tr>;})}</tbody></table></div><p className="admin-funnel-note">An account can report multiple steps or repeat a step. Row counts cannot be added to get unique people. No institution or department is inferred from these reports.</p></section>
 <details className="admin-panel admin-definitions"><summary>Sources, coverage and definitions</summary><dl>{Object.entries(data.definitions).map(([key,value])=><div key={key}><dt>{key[0].toUpperCase()+key.slice(1)}</dt><dd>{value}</dd></div>)}</dl><p className="admin-funnel-note">Feedback storage available since {data.coverage.reportsSince?new Date(data.coverage.reportsSince).toLocaleString():'unknown'}. Opening measurement available since {data.coverage.promptsSince?new Date(data.coverage.promptsSince).toLocaleString():'unknown'}. These are schema availability dates; collection can be disabled. Retention: {data.coverage.retentionDays} days.</p></details>
 <p className="admin-quality-caption">Updated {new Date(data.generatedAt).toLocaleString()} · UTC receipt window {new Date(data.window.start).toISOString()} to {new Date(data.window.end).toISOString()} · No research or institution export.</p>
 </div>;
}
