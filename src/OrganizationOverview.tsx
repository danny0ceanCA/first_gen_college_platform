import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {Users,GraduationCap,BookOpen,AudioLines} from 'lucide-react';
import {apiFetch} from './api';
import {getStaffAccessToken,staffVerificationErrors} from './StaffVerification';

type Overview={organizationId:string;generatedAt:string;days:number;periodStart:string;periodEnd:string;activeCoordinators:number;totalCoordinators:number;linkedStudents:number;sharedBinders:number;pendingConnections:number;voiceMinutes:number;voiceCalls:number;voiceTrackingSince:string|null};
const count=new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const date=(value:string)=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

export default function OrganizationOverview({organizationId,onError}:{organizationId:string;onError:(code:string)=>void}){
 const {getAccessTokenSilently}=useAuth0();
 const [days,setDays]=useState(30),[revision,setRevision]=useState(0),[data,setData]=useState<Overview>(),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();let current=true;setLoading(true);setError('');setData(undefined);
  void (async()=>{
   try{
    const token=await getStaffAccessToken(()=>getAccessTokenSilently());if(!current)return;
    const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'organization-overview',organizationId,days}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'organization_overview_unavailable');
    if(result.organizationId!==organizationId||result.days!==days)throw new Error('organization_overview_unavailable');
    if(current)setData(result);
   }catch(e){if(current){const code=(e as Error).message;setError(code);if(staffVerificationErrors.includes(code))onError(code);}}
   finally{if(current)setLoading(false);}
  })();
  return()=>{current=false;controller.abort();};
 },[organizationId,days,revision,getAccessTokenSilently,onError]);
 const metrics=[
  {label:'Active coordinators',value:data?.activeCoordinators,icon:Users,detail:data?`${count.format(data.totalCoordinators)} registered`:'Current access'},
  {label:'Linked students',value:data?.linkedStudents,icon:GraduationCap,detail:'Each student counted once'},
  {label:'Shared binders',value:data?.sharedBinders,icon:BookOpen,detail:'Currently available to coordinators'},
  {label:'Recorded voice minutes',value:data?.voiceMinutes,icon:AudioLines,detail:`Past ${days} days`},
 ];
 return <section className="organization-overview" aria-label="Organization overview" aria-busy={loading}>
  <div className="organization-overview-heading"><h3>At a glance</h3><label>Voice activity<select aria-label="Voice activity period" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Past 7 days</option><option value={30}>Past 30 days</option><option value={90}>Past 90 days</option></select></label></div>
  <dl className="organization-overview-metrics">{metrics.map(({label,value,icon:Icon,detail})=><div key={label}><dt><Icon size={17}/>{label}</dt><dd>{value===undefined?'—':count.format(value)}</dd><p>{detail}</p></div>)}</dl>
  {loading?<p className="organization-overview-status" role="status">Loading organization activity…</p>:error?<p className="organization-overview-status" role="alert">{error==='invalid_action'?'Organization activity will be available after the API update.':error==='staff_permission_required'?'Institution reporting permission is needed to see this overview.':'Organization activity could not be loaded.'} <button className="text-button" onClick={()=>setRevision(v=>v+1)}>Try again</button></p>:data&&<>
   <div className="organization-overview-secondary"><span><strong>{count.format(data.pendingConnections)}</strong> pending connection requests</span><span><strong>{count.format(data.voiceCalls)}</strong> recorded calls in {days} days</span></div>
   <p className="organization-overview-updated">People and binder counts are current. Voice totals cover tracked calls only{data.voiceTrackingSince?`, since ${date(data.voiceTrackingSince)}`:''}. Updated {new Date(data.generatedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}.</p>
   <details className="organization-overview-definitions"><summary>How these numbers are counted</summary><p>Linked students have an accepted, unexpired connection to an active coordinator. Students and shared binders count once here, even when several coordinators support the same student. Pending requests count separately.</p><p>Voice usage covers {date(data.periodStart)}–{date(data.periodEnd)} (UTC). {data.voiceTrackingSince?`Organization tracking began ${date(data.voiceTrackingSince)}. `:''}Only recorded student calls linked to this organization when the call started are included. Family, parent, mixed, and unattributed calls are excluded. Earlier calls are not reconstructed.</p><p>Minutes are estimated connected time from call heartbeats, capped at 10 minutes per connection. A call linked to two organizations counts once for each; organization totals should not be added together. These are usage counts, with no conversation content.</p></details>
  </>}
 </section>;
}
