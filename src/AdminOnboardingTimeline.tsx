import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,CheckCircle2,Clock3} from 'lucide-react';
import {apiFetch} from './api';

type Props={id:string;days:number;revision:number;onDenied:()=>void};
type Attempt={id:string;started_at:string;last_received_at:string;resumed:boolean;saved_at:string|null;eventCount:number;homeReached:boolean;logoutSelected:boolean;saveFailed:boolean;voiceFailed:boolean;clientSaveSucceeded:boolean};
type Timeline={attempts:Attempt[];total:number;page:number;pageSize:number;coverage:{available:boolean;measuredSince:string|null;retentionDays:number;olderAccount:boolean}};
type Metadata={language?:string;method?:string;restored?:boolean;reason?:string;code?:string;fields?:Record<string,boolean>;voiceSessionId?:string;voiceAttemptId?:string;durationMs?:number;speechIndex?:number;responseIndex?:number;status?:string;playbackReady?:boolean;surface?:string;captureVersion?:number;retryCount?:number;droppedCount?:number;gapReason?:string};
type Event={producer:string;sequence:number;name:string;occurred_at:string;received_at:string;metadata:Metadata};
type Events={events:Event[];total:number;page:number;pageSize:number};
const date=(value:string)=>new Date(value).toLocaleString();
const labels:Record<string,string>={onboarding_opened:'Opened onboarding',fields_updated:'Profile fields updated',voice_button_pressed:'Selected the voice button',voice_start_requested:'Requested a voice connection',microphone_allowed:'Microphone access allowed',microphone_denied:'Microphone access denied',microphone_failed:'Microphone could not start',voice_connected:'Voice connection ready',voice_connection_failed:'Voice connection failed',voice_ended:'Voice session ended',save_requested:'Requested profile save',validation_failed:'Required information missing',save_succeeded:'Browser received save confirmation',save_failed:'Profile save request failed',profile_saved:'Profile saved · server confirmed',home_reached:'Web home page reached',logout_selected:'Selected log out',logout_failed:'Log out request failed',page_hidden:'Page moved into the background',page_visible:'Page became visible',page_leaving:'Page was leaving',setup_method_changed:'Setup method or language changed'};
const reasons:Record<string,string>={user_end:'User ended the call',logout:'Log out selected',connection_lost:'Connection lost',connection_failed:'Connection failed',connection_timeout:'Connection timed out',time_limit:'Call time limit reached',screen_unmounted:'Voice screen closed',unknown:'End reason unknown',missing_details:'Required information missing',request_failed:'Request failed'};
const methods:Record<string,string>={voice:'Voice setup',manual:'Manual entry',name:'Name entry',choice:'Setup choice'};
const fields:Record<string,string>={account_name:'Account name',account_role:'Student / parent role',student_name:'Student name',stage:'Education stage',school:'School',interest:'Interests',gpa:'GPA',activities:'Activities',goals:'Goals',institutions:'Institutions',entryTerm:'Entry term',needs:'Practical needs',notes:'Notes'};
Object.assign(labels,{first_agent_audio:'First agent audio observed in browser playback',first_user_speech:'First user speech detected',user_speech_started:'User speech detected',user_speech_stopped:'Detected speech ended',user_speech_transcription:'Speech transcription outcome',speech_during_agent_audio:'Speech detected during agent audio',agent_audio_started:'Agent audio buffer started',agent_audio_drained:'Agent audio buffer drained',agent_audio_cleared:'Agent audio buffer cleared',agent_response_finished:'Agent response generation finished',audio_playback_started:'Browser playback started',audio_playback_blocked:'Browser playback unavailable',audio_playback_resumed:'Browser playback resumed',audio_playback_paused:'Browser playback paused',microphone_muted:'Microphone muted',microphone_unmuted:'Microphone unmuted',save_confirmation_waiting:'Waiting for spoken save confirmation',save_confirmation_started:'Save confirmation response started',save_confirmation_audio_started:'Save confirmation audio started',save_confirmation_finished:'Save confirmation audio drained',save_confirmation_interrupted:'Save confirmation interrupted',save_confirmation_skipped:'Call ended before confirmation audio drained',home_transition_started:'Home transition started',home_transition_open_requested:'Home render requested',home_transition_finished:'Home transition animation finished',home_transition_failed:'Home transition failed',home_transition_cancelled:'Home transition cancelled',home_guide_update_started:'Configuring guide for home',home_guide_update_finished:'Home guide configured in the same call',home_guide_update_failed:'Home guide update failed',home_introduction_requested:'App introduction requested',home_introduction_started:'App introduction response started',home_introduction_finished:'App introduction audio drained',home_introduction_failed:'App introduction interrupted or unavailable',native_handoff_requested:'Native host handoff requested',native_handoff_acknowledged:'Native host acknowledged handoff',native_handoff_failed:'Native host handoff failed'});
Object.assign(reasons,{cancelled:'Response cancelled',failed:'Response failed',incomplete:'Response incomplete',buffer_cleared:'Audio buffer cleared',call_ended:'Call ended',home_not_rendered:'Home page surface was not found'});
Object.assign(labels,{tracking_delivery_recovered:'Onboarding event delivery recovered',tracking_delivery_gap:'Client reported a diagnostic delivery gap'});
const statuses:Record<string,string>={accepted:'Speech accepted as a turn',empty:'Speech was empty or ignored',failed:'Failed',timeout:'Transcription timed out',completed:'Generation completed',cancelled:'Generation cancelled',incomplete:'Generation incomplete',drained:'Provider reported audio drain'};

function useHistory<T>(props:Props,action:string,page:number,retry:number,attemptId?:string,enabled=true){
 const {getAccessTokenSilently}=useAuth0();
 const denied=useRef(props.onDenied);denied.current=props.onDenied;
 const [data,setData]=useState<T>(),[error,setError]=useState('');
 useEffect(()=>{
  if(!enabled)return;
  const abort=new AbortController();setData(undefined);setError('');
  void (async()=>{
   const token=await getAccessTokenSilently();
   const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,id:props.id,days:props.days,page,attemptId}),signal:abort.signal});
   if(abort.signal.aborted)return;
   if(!response.ok){
    if([401,403].includes(response.status))denied.current();
    throw new Error(response.status===404?'This account or attempt is no longer available. Refresh the account details.':'Onboarding history could not be loaded. Please try again.');
   }
   const next=await response.json();if(!abort.signal.aborted)setData(next);
  })().catch(error=>{if(!abort.signal.aborted)setError(error.message);});
  return()=>abort.abort();
 },[props.id,props.days,props.revision,action,page,retry,attemptId,enabled,getAccessTokenSilently]);
 return {data,error};
}
function Pagination({page,total,size,onPage,label}:{page:number;total:number;size:number;onPage:(page:number)=>void;label:string}){
 if(total<=size)return null;
 return <nav className="admin-onboarding-pagination" aria-label={label}><span aria-live="polite">{(page-1)*size+1}–{Math.min(page*size,total)} of {total}</span><div><button aria-label={`Previous ${label}`} disabled={page===1} onClick={()=>onPage(page-1)}><ChevronLeft size={16}/></button><span>Page {page} of {Math.ceil(total/size)}</span><button aria-label={`Next ${label}`} disabled={page*size>=total} onClick={()=>onPage(page+1)}><ChevronRight size={16}/></button></div></nav>;
}
function EventDetail({event}:{event:Event}){
 const m=event.metadata,provided=Object.entries(m.fields??{}).filter(([key,value])=>fields[key]&&value).map(([key])=>fields[key]),blank=Object.entries(m.fields??{}).filter(([key,value])=>fields[key]&&!value).map(([key])=>fields[key]);
 return <li className={['save_failed','voice_connection_failed','microphone_denied','microphone_failed','validation_failed','logout_failed'].includes(event.name)?'has-issue':event.name==='profile_saved'?'is-confirmed':''}>
  <div className="admin-onboarding-event-heading"><strong>{labels[event.name]??'Unrecognized diagnostic event'}</strong><time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></div>
  {(m.language||m.method||m.restored!==undefined)&&<p>{[m.language==='es'?'Spanish':m.language==='en'?'English':null,m.method?methods[m.method]:null,m.restored===true?'Browser draft restored':null].filter(Boolean).join(' · ')}</p>}
  {m.reason&&reasons[m.reason]&&<p>{reasons[m.reason]}</p>}
  {m.code&&<p className="admin-onboarding-code">Technical code: {m.code}</p>}
  {m.status&&statuses[m.status]&&<p>{statuses[m.status]}</p>}
  {m.durationMs!==undefined&&<p>{event.name.startsWith('first_')?'After voice request':event.name==='user_speech_stopped'?'Detected speech duration':event.name.startsWith('home_transition')?'Transition duration':event.name.startsWith('native_')?'Time closing onboarding':'Time waiting for audio completion'}: {(m.durationMs/1000).toLocaleString(undefined,{maximumFractionDigits:2})} s</p>}
  {m.playbackReady!==undefined&&<p>{m.playbackReady?'Browser playback was ready.':'Browser playback was not ready; audibility is unknown.'}</p>}
  {m.retryCount!==undefined&&<p>Failed delivery attempts before recovery: {m.retryCount}.</p>}
  {m.droppedCount!==undefined&&<p>Diagnostics dropped: {m.droppedCount}. {({expired:'The local retry window expired.',capacity:'The bounded local queue was full.',invalid:'A local diagnostic record was invalid.',request_rejected:'The server rejected a diagnostic batch.'} as Record<string,string>)[m.gapReason||'']}</p>}
  {!!provided.length&&<p>Provided: {provided.join(', ')}.</p>}{!!blank.length&&<p>Not provided: {blank.join(', ')}.</p>}
  <details className="admin-onboarding-technical"><summary>Event reference</summary><p>{event.producer==='server'?'Server':'Browser'} event {event.sequence} · received {date(event.received_at)}</p>{m.captureVersion&&<p>Capture version {m.captureVersion}</p>}{m.surface&&<p>{m.surface==='native'?'Native WebView':'Web browser'}</p>}{m.speechIndex&&<p>Detected speech segment {m.speechIndex}</p>}{m.responseIndex&&<p>Agent response {m.responseIndex}</p>}{m.voiceSessionId&&<p>Voice session: <code>{m.voiceSessionId}</code></p>}{m.voiceAttemptId&&<p>Voice attempt: <code>{m.voiceAttemptId}</code></p>}</details>
 </li>;
}
function AttemptEvents(props:Props&{attemptId:string}){
 const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
 const {data,error}=useHistory<Events>(props,'onboarding-attempt',page,retry,props.attemptId);
 useEffect(()=>{if(data&&page>1&&(page-1)*data.pageSize>=data.total)setPage(Math.max(1,Math.ceil(data.total/data.pageSize)));},[data,page]);
 return <div className="admin-onboarding-events-body">{error?<div className="admin-error" role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>Retry events</button></div>:!data?<p role="status">Loading attempt events…</p>:<>{data.events.length?<ol className="admin-onboarding-events">{data.events.map(event=><EventDetail key={event.producer+event.sequence} event={event}/>)}</ol>:<p>No detailed events retained for this attempt.</p>}<Pagination page={page} total={data.total} size={data.pageSize} onPage={setPage} label="events"/></>}</div>;
}
function AttemptCard(props:Props&{attempt:Attempt;initialOpen:boolean}){
 const a=props.attempt,[expanded,setExpanded]=useState(props.initialOpen);
 return <details className="admin-onboarding-attempt" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary><span className="admin-onboarding-attempt-title">{a.saved_at?<CheckCircle2 size={17}/>:<Clock3 size={17}/>}<span><strong>{a.saved_at?'Profile saved':'No server-confirmed save recorded'}</strong><span>{a.resumed?'Another recorded visit':'First retained visit'} · first received {date(a.started_at)}</span></span></span><span className="admin-onboarding-count">{a.eventCount} events</span></summary>
  <div className="admin-onboarding-attempt-context">
   {a.saved_at&&<p>Server confirmed the save at {date(a.saved_at)}.</p>}
   <p>{a.homeReached?'The browser reported reaching the web home page.':'Home arrival was not recorded (web only); the navigation outcome is unknown.'}</p>
   {!a.saved_at&&a.clientSaveSucceeded&&<p>The browser reported a successful save, but a server confirmation is unavailable for this attempt.</p>}
   {(a.saveFailed||a.voiceFailed||a.logoutSelected)&&<div className="admin-onboarding-signals">{a.saveFailed&&<span>Save failure recorded</span>}{a.voiceFailed&&<span>Voice connection failure recorded</span>}{a.logoutSelected&&<span>Log out selected</span>}</div>}
   <p className="admin-funnel-note">Last receipt: {date(a.last_received_at)}.{!a.saved_at&&' The save outcome is unknown; this attempt is not classified as abandoned.'}</p>
   <p className="admin-onboarding-reference">Attempt <code>{a.id}</code></p>
  </div>
  {expanded&&<AttemptEvents {...props} attemptId={a.id}/>}
 </details>;
}
export default function AdminOnboardingTimeline(props:Props){
 const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
 const {data,error}=useHistory<Timeline>(props,'onboarding-timeline',page,retry);
 useEffect(()=>{setPage(1);},[props.id,props.days]);
 useEffect(()=>{if(data&&page>1&&(page-1)*data.pageSize>=data.total)setPage(Math.max(1,Math.ceil(data.total/data.pageSize)));},[data,page]);
 return <section className="admin-onboarding" aria-labelledby="admin-onboarding-title"><div className="admin-onboarding-heading"><div><h3 id="admin-onboarding-title">Onboarding history</h3><p>Separate visits, voice setup and profile saves · last {props.days} days</p></div>{data?.coverage.available&&<span className="admin-count">{data.total} attempts</span>}</div>
  {error?<div className="admin-error" role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>Retry history</button></div>:!data?<p role="status">Loading onboarding history…</p>:!data.coverage.available?<div className="admin-onboarding-coverage"><strong>Detailed tracking is not available yet.</strong><p>The event capture migration has not been applied. Account milestones and sign-ins below remain available.</p></div>:<>
   <div className="admin-onboarding-coverage"><p>Detailed capture began {date(data.coverage.measuredSince!)}. {data.coverage.olderAccount?'This account predates detailed capture; earlier visits cannot be reconstructed.':''}</p><details><summary>About this history</summary><p>Attempts inactive for {data.coverage.retentionDays} days are removed. Missing events may reflect delivery gaps or an older capture version. Speech and playback diagnostics require capture version 3. Playback signals do not verify that the person heard audio. A native host acknowledgement does not confirm native home rendered.</p><p>Attempts are selected by receipt activity in this period; each expanded visit shows its full retained history, oldest first. Times use your device’s time zone; browser clocks may differ from server receipt times. Durations are measured on one device clock. Field flags show presence only, never answers or conversation content.</p></details></div>
   {data.attempts.length?<div className="admin-onboarding-attempts">{data.attempts.map((attempt,index)=><AttemptCard key={attempt.id} {...props} attempt={attempt} initialOpen={index===0}/>)}</div>:<p className="admin-onboarding-empty">No detailed attempts were recorded in this period. This does not mean the person never opened onboarding. Review the account milestones and activity below.</p>}
   <Pagination page={page} total={data.total} size={data.pageSize} onPage={setPage} label="attempts"/>
  </>}
 </section>;
}

