import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,AudioLines,CheckCircle2,Clock3,FileText,LogIn,RefreshCw,TriangleAlert,X} from 'lucide-react';
import {apiFetch} from './api';
import {type AdminUser,JourneyStatus,date,number,activityLabels,roleLabel} from './adminUserPresentation';
import AdminOnboardingTimeline from './AdminOnboardingTimeline';
import AdminUserConversations from './AdminUserConversations';

type Props={id:string;days:number;revision:number;onClose:()=>void;onDenied:()=>void};
type HistoryEvent={id:string;kind:string;category:string;problem:boolean;recordedAt:string;occurredAt:string|null;evidence:string;attemptId:string|null;title:string;note:string};
type History={events:HistoryEvent[];counts:Record<string,number>;recap:{title:string;lines:string[]};total:number;page:number;pageSize:number;category:string;window:{start:string;end:string;days:number};coverage:{measuredSince:Record<string,string>;onboardingRetentionDays:number;guidanceEnabled:boolean}};
const filters=[['all','All events'],['access','Account & sign-ins'],['onboarding','Onboarding'],['voice','Conversations'],['summaries','Summaries'],['problems','Recorded problems']];
const sources=[['017_admin_activity.sql','Sign-ins and calls'],['027_onboarding_events.sql','Detailed onboarding'],['019_voice_quality.sql','Voice diagnostics'],['015_guidance_history.sql','Summary generation diagnostics']];
export default function AdminUserDrawer(props:Props){
 const {getAccessTokenSilently}=useAuth0(),dialog=useRef<HTMLDialogElement>(null),denied=useRef(props.onDenied);denied.current=props.onDenied;
 const [detail,setDetail]=useState<AdminUser>(),[detailError,setDetailError]=useState(''),[history,setHistory]=useState<History>(),[historyError,setHistoryError]=useState('');
 const [category,setCategory]=useState('all'),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[historyRetry,setHistoryRetry]=useState(0),[diagnostics,setDiagnostics]=useState(false);
 const [conversations,setConversations]=useState(false);
 const cutoff=useRef<string|undefined>(undefined),timelineHeading=useRef<HTMLHeadingElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const node=dialog.current,opener=document.activeElement as HTMLElement|null;node?.showModal();closeButton.current?.focus();return()=>{node?.close();if(opener?.isConnected)opener.focus();};},[]);
 async function request(body:object,signal:AbortSignal){
  const token=await getAccessTokenSilently();if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal});
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!response.ok){if([401,403].includes(response.status)){setDetail(undefined);setHistory(undefined);denied.current();}throw new Error(response.status===404?'This account is no longer available.':response.status===400?'This report has expired. Refresh the user view.':'Could not load this information. Please try again.');}
  return response.json();
 }
 useEffect(()=>{
  const abort=new AbortController();setDetail(undefined);setDetailError('');
  void request({action:'user-detail',id:props.id,days:props.days},abort.signal).then(next=>{if(!abort.signal.aborted)setDetail(next.user);}).catch(e=>{if(!abort.signal.aborted)setDetailError(e.message);});
  return()=>abort.abort();
 },[props.id,props.days,props.revision,retry]);
 // The owner remounts this drawer on account/period changes. Refresh explicitly
 // resets the receipt cutoff so newer events never reshuffle a paged report.
 useEffect(()=>{
  const abort=new AbortController();setHistory(undefined);setHistoryError('');
  void request({action:'user-history',id:props.id,days:props.days,page,category,asOf:cutoff.current},abort.signal).then(next=>{
   if(abort.signal.aborted)return;cutoff.current=next.window.end;
   if(page>1&&(page-1)*next.pageSize>=next.total)setPage(Math.max(1,Math.ceil(next.total/next.pageSize)));else setHistory(next);
  }).catch(e=>{if(!abort.signal.aborted)setHistoryError(e.message);});
  return()=>abort.abort();
 },[props.id,props.days,props.revision,page,category,historyRetry,retry]);
 function refresh(){cutoff.current=undefined;setPage(1);setRetry(x=>x+1);}
 function changePage(value:number){setPage(value);timelineHeading.current?.focus();}
 return <dialog ref={dialog} className="admin-user-dialog admin-user-drawer" aria-labelledby="admin-detail-title" onCancel={e=>{e.preventDefault();props.onClose();}} onClick={e=>{if(e.target===dialog.current){const b=dialog.current.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)props.onClose();}}}>
  <header className="admin-user-drawer-header"><div><p>User journey</p><h2 id="admin-detail-title">{detail?.first_name||'Account details'}</h2></div><div><button aria-label="Refresh user view" onClick={refresh}><RefreshCw size={18}/></button><button ref={closeButton} aria-label="Close account details" onClick={props.onClose}><X size={20}/></button></div></header>
  <div className="admin-user-drawer-body">
   {detailError?<div className="admin-error" role="alert">{detailError} <button onClick={()=>setRetry(x=>x+1)}>Retry details</button></div>:!detail?<p role="status">Loading account…</p>:<>
    <div className="admin-user-identity"><JourneyStatus user={detail}/><p>{roleLabel(detail.role)} · {detail.student_profiles===undefined?'Student profiles not recorded':`${number(detail.student_profiles)} saved student ${Number(detail.student_profiles)===1?'profile':'profiles'}`}</p><details><summary>Account reference</summary><code>{detail.id}</code><p>Admin access: {detail.admin_access==='confirmed'?'Confirmed by the backend for this report':'Not verified here · check Auth0'}</p></details></div>
    <div className="admin-detail-usage"><span><strong>{number(detail.logins)}</strong>Sign-ins · {props.days} days</span><span><strong>{number(detail.calls)}</strong>Calls · {props.days} days</span><span><strong>{number(detail.voice_minutes)}</strong>Connected minutes · {props.days} days</span></div>
    <details className="admin-user-milestones"><summary>Account milestones & latest activity</summary><dl className="admin-detail-facts"><dt>Registered</dt><dd>{date(detail.created_at)}</dd><dt>Onboarding opened</dt><dd>{date(detail.onboarding_started_at)}</dd><dt>Confirmed profile save</dt><dd>{date(detail.onboarding_completed_at)}{!detail.onboarding_completed_at&&detail.profile_details_present&&' · details exist, but save history is missing'}</dd><dt>First post-setup call</dt><dd>{date(detail.first_guidance_at)}</dd><dt>Last recorded activity</dt><dd>{date(detail.last_activity_at)}<small>{activityLabels[detail.last_activity_kind||'']||'Activity source not recorded'}</small></dd><dt>Last sign-in</dt><dd>{date(detail.last_login)}</dd></dl></details>
   </>}
   <section className="admin-user-recap" aria-labelledby="admin-user-recap-title"><p className="admin-user-eyebrow">What happened · last {props.days} days</p><h3 id="admin-user-recap-title">{history?.recap.title||'Recorded journey recap'}</h3>{history?<><ul>{history.recap.lines.map(line=><li key={line}>{line}</li>)}</ul><small>Built from recorded events. No AI inference or conversation text.</small></>:<p role="status">{historyError?'Recap unavailable until history loads.':'Loading recorded history…'}</p>}</section>
   {history&&<section className="admin-user-summary-status" aria-label="Summary storage status"><FileText size={20}/><div><strong>{number(history.counts.summaries)} stored {history.counts.summaries===1?'summary':'summaries'} · {props.days} days</strong><p>{history.counts.summary_failures?`${number(history.counts.summary_failures)} summary processing failure signals recorded. Later retries may have succeeded.`:'No summary processing failure signals recorded.'} Summary storage is shown separately from calls; missing records do not establish a failed save.</p></div></section>}
   <section className="admin-user-diagnostics admin-user-conversations"><button aria-expanded={conversations} aria-controls="admin-user-conversations-content" onClick={()=>setConversations(x=>!x)}>{conversations?'Hide':'Open'} conversation records</button>{conversations&&<div id="admin-user-conversations-content"><AdminUserConversations id={props.id} days={props.days} revision={props.revision+retry} onDenied={props.onDenied}/></div>}</section>
   <section className="admin-user-history" aria-labelledby="admin-user-history-title">
    <div className="admin-user-history-heading"><div><h3 id="admin-user-history-title" ref={timelineHeading} tabIndex={-1}>Journey timeline</h3><p>Newest first · server record or receipt time · last {props.days} days</p></div><label>Show events<select value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}>{filters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    {historyError?<div className="admin-error" role="alert">{historyError} <button onClick={()=>setHistoryRetry(x=>x+1)}>Retry history</button></div>:!history?<p role="status">Loading journey events…</p>:<>
     <p className="admin-history-cutoff">Through {date(history.window.end)} · dates use your local time zone.</p>
     {history.events.length?<ol className="admin-unified-events">{history.events.map(event=>{const Icon=event.problem?TriangleAlert:event.kind==='profile_saved'||event.kind==='summary_stored'?CheckCircle2:event.category==='voice'?AudioLines:event.category==='access'?LogIn:Clock3;return <li key={event.id} className={event.problem?'has-problem':''}><span className="admin-history-icon"><Icon size={17}/></span><div><div className="admin-history-event-title"><strong>{event.title}</strong><time dateTime={event.recordedAt}>{date(event.recordedAt)}</time></div><span className="admin-history-evidence">{event.evidence==='server'?'Server record':'Browser report'}{event.problem?' · problem signal':''}</span><p>{event.note}</p>{(event.occurredAt||event.attemptId)&&<details className="admin-history-reference"><summary>Event timing & reference</summary>{event.occurredAt&&<p>Browser event time: {date(event.occurredAt)}. Device clocks and queued delivery can differ from receipt time.</p>}{event.attemptId&&<p>Onboarding visit: <code>{event.attemptId}</code></p>}</details>}</div></li>;})}</ol>:<div className="admin-history-empty"><Clock3 size={24}/><h4>No matching recorded events</h4><p>Try another event type or reporting period. Missing history does not establish inactivity.</p></div>}
     {history.total>history.pageSize&&<nav className="admin-onboarding-pagination" aria-label="Journey timeline pages"><span role="status">{(page-1)*history.pageSize+1}–{Math.min(page*history.pageSize,history.total)} of {history.total}</span><div><button aria-label="Newer journey events" disabled={page===1} onClick={()=>changePage(page-1)}><ArrowLeft size={16}/></button><span>Page {page}</span><button aria-label="Older journey events" disabled={page*history.pageSize>=history.total} onClick={()=>changePage(page+1)}><ArrowRight size={16}/></button></div></nav>}
     <details className="admin-history-coverage"><summary>History coverage & limits</summary><p>The timeline combines key events. Detailed speech and playback diagnostics remain in onboarding diagnostics below. Problem signals can overlap and are not a count of unique or unresolved incidents.</p><p>Sign-ins cover web sign-in returns. Connected minutes include listening and pauses. Call topics are their starting guide, not a transcript of what was discussed. No end receipt does not establish an active call.</p><p>Summary records confirm current storage, including possible imports. Deleted summaries and expired diagnostics are absent. No per-call summary outcome is inferred from timing. Summary generation diagnostics {history.coverage.guidanceEnabled?'are currently enabled':'are currently disabled; historical records may still be present'}.</p><p>Onboarding diagnostic retention: {history.coverage.onboardingRetentionDays} days. Guidance diagnostics have a 90-day retention policy. Capture can be incomplete even after a migration was applied.</p><dl>{sources.map(([key,label])=><div key={key}><dt>{label} tracking available since</dt><dd>{date(history.coverage.measuredSince[key])}</dd></div>)}</dl></details>
    </>}
   </section>
   <section className="admin-user-diagnostics"><button aria-expanded={diagnostics} aria-controls="admin-user-diagnostics-content" onClick={()=>setDiagnostics(x=>!x)}>{diagnostics?'Hide':'Open'} detailed onboarding diagnostics</button>{diagnostics&&<div id="admin-user-diagnostics-content"><AdminOnboardingTimeline id={props.id} days={props.days} revision={props.revision+retry} onDenied={props.onDenied}/></div>}</section>
  </div>
 </dialog>;
}
