import {useCallback,useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {Search,Users,Building2,GraduationCap,BookOpen,MessageSquare,CheckCircle2} from 'lucide-react';
import {apiFetch} from './api';
import {getStaffAccessToken,staffVerificationErrors} from './StaffVerification';
import OrganizationOverview from './OrganizationOverview';
import CoordinatorActivation from './CoordinatorActivation';

type RecordItem={id:string;name:string;status:string;email?:string;organizationName?:string;jobRole?:string;approvedAt?:string};
type Overview={id:string;days:number;active:boolean;linkedStudents:number;sharedBinders:number;pendingConnections:number;guidanceEntries:number;reviewedEntries:number;lastGuidanceAt:string|null};
type Request=(input:unknown,signal:AbortSignal)=>Promise<any>;
const statusLabel=(item:RecordItem)=>item.status==='active'?'Access enabled':item.status==='suspended'?'Access suspended':item.status==='inactive'?'Access inactive':'Affiliation approved';

function CoordinatorOverview({id,request,onError}:{id:string;request:Request;onError:(code:string)=>void}){
 const [days,setDays]=useState(30),[data,setData]=useState<Overview>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setData(undefined);setError('');
  void request({action:'coordinator-overview',id,days},controller.signal).then(result=>{
   if(!controller.signal.aborted){if(result.id!==id||result.days!==days)throw Error('invalid_overview');setData(result);}
  }).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(staffVerificationErrors.includes(e.message))onError(e.message);}});
  return()=>controller.abort();
 },[id,days,retry,request,onError]);
 const metrics=[{label:'Linked students',value:data?.linkedStudents,icon:GraduationCap,detail:'Current accepted connections'},
  {label:'Shared binders',value:data?.sharedBinders,icon:BookOpen,detail:'Currently available to this coordinator'},
  {label:'Guidance entries',value:data?.guidanceEntries,icon:MessageSquare,detail:`Sent in the past ${days} days`},
  {label:'Reviewed by students',value:data?.reviewedEntries,icon:CheckCircle2,detail:'Latest version marked reviewed'}];
 return <section className="organization-overview" aria-label="Coordinator statistics" aria-busy={!data&&!error}>
  <div className="organization-overview-heading"><h3>At a glance</h3><label>Guidance activity<select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Past 7 days</option><option value={30}>Past 30 days</option><option value={90}>Past 90 days</option></select></label></div>
  <dl className="organization-overview-metrics">{metrics.map(({label,value,icon:Icon,detail})=><div key={label}><dt><Icon size={17}/>{label}</dt><dd>{value===undefined?'—':value.toLocaleString()}</dd><p>{detail}</p></div>)}</dl>
  {error?<p role="alert" className="organization-overview-status">Could not load coordinator activity. <button className="text-button" onClick={()=>setRetry(v=>v+1)}>Try again</button></p>:!data?<p role="status" className="organization-overview-status">Loading coordinator activity…</p>:<>
   {!data.active&&<p className="approval-help">Approval is on record, but access is currently inactive. Current student and binder counts are zero.</p>}
   <div className="organization-overview-secondary"><span><strong>{data.pendingConnections}</strong> pending connections</span></div>
   <p className="organization-overview-updated">{data.lastGuidanceAt?`Latest guidance activity in this period: ${new Date(data.lastGuidanceAt).toLocaleDateString()}.`:'No guidance activity in this period.'}</p>
   <details className="organization-overview-definitions"><summary>How these numbers are counted</summary><p>Student and binder counts reflect current access in this organization. Guidance counts include notes, resources, and suggested steps created during the selected period; withdrawn or removed entries are excluded. Reviewed means a student marked the latest version reviewed, not that they completed a suggested step. No student names or conversation content are shown.</p></details>
  </>}
 </section>;
}

export default function ApprovedDirectory({kind,onError}:{kind:'organizations'|'coordinators';onError:(code:string)=>void}){
 const {getAccessTokenSilently}=useAuth0();
 const [search,setSearch]=useState(''),[after,setAfter]=useState(''),[next,setNext]=useState(''),[items,setItems]=useState<RecordItem[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const request=useCallback<Request>(async(input,signal)=>{
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  const data=await response.json();if(!response.ok)throw Error(data.error||'approved_directory_unavailable');return data;
 },[getAccessTokenSilently]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setItems([]);setNext('');
  const timer=window.setTimeout(()=>{void request({action:'approved-directory',kind,search,after},controller.signal).then(data=>{
   if(!controller.signal.aborted){setItems(data.items);setNext(data.next||'');setSelected(current=>data.items.some((i:RecordItem)=>i.id===current)?current:data.items[0]?.id||'');}
  }).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(staffVerificationErrors.includes(e.message))onError(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[kind,search,after,revision,request,onError]);
 const item=items.find(i=>i.id===selected),Icon=kind==='organizations'?Building2:Users;
 return <section className="org-review" aria-label={`Approved ${kind}`}>
  <div className="approval-section-intro"><div><h2>Approved {kind}</h2><p>{kind==='organizations'?'Find approved organizations and follow their activity.':'Find approved coordinators and see how they support students.'}</p></div><button className="button outline" disabled={loading} onClick={()=>setRevision(v=>v+1)}>Refresh directory</button></div>
  <div className="org-review-workspace"><aside className="org-review-list"><label className="org-review-search"><Search size={17}/><input aria-label={`Search approved ${kind}`} placeholder={kind==='organizations'?'Find an organization…':'Name, email, or organization…'} maxLength={200} value={search} onChange={e=>{setSearch(e.target.value);setAfter('');}}/></label>
   <div className="org-review-rows">{items.map(i=><button key={i.id} className="org-review-row" aria-current={i.id===selected?'true':undefined} onClick={()=>setSelected(i.id)}><span className="org-review-row-name"><Icon size={18}/><strong>{i.name}</strong></span>{i.organizationName&&<span className="org-review-row-person">{i.organizationName}</span>}<span className={`org-review-badge ${i.status==='active'?'ready':''}`}>{statusLabel(i)}</span></button>)}</div>
   <div className="approval-pagination">{after&&<button disabled={loading} onClick={()=>setAfter('')}>First page</button>}{next&&<button disabled={loading} onClick={()=>setAfter(next)}>Next page</button>}</div>
  </aside>{item?<article className="org-review-detail"><header><span className={`org-review-badge ${item.status==='active'?'ready':''}`}>{statusLabel(item)}</span><h2>{item.name}</h2>{item.organizationName&&<p className="approval-help">{item.organizationName}{item.jobRole?` · ${item.jobRole}`:''}</p>}</header>
   {kind==='organizations'?<OrganizationOverview key={`${item.id}-${revision}`} organizationId={item.id} onError={onError}/>:<><section className="org-review-info"><dl><div><dt>Email</dt><dd>{item.email}</dd></div><div><dt>Approved</dt><dd>{item.approvedAt?new Date(item.approvedAt).toLocaleDateString():'On record'}</dd></div></dl></section><CoordinatorActivation key={`activation-${item.id}-${revision}`} id={item.id} request={request} onError={onError}/><CoordinatorOverview key={`${item.id}-${revision}`} id={item.id} request={request} onError={onError}/></>}
  </article>:<div className="org-review-empty" role={error?'alert':'status'}><Icon size={32}/><h2>{loading?'Loading…':error?'Directory unavailable':search?'No matches found':after?'No more records':'No approved records yet'}</h2>{error?<><p>The directory could not be loaded. Your records have not changed.</p><button className="button outline" onClick={()=>setRevision(v=>v+1)}>Try again</button></>:!loading&&<p>{search?'Try a different name or clear your search.':'Approved records appear here after review.'}</p>}</div>}</div>
 </section>;
}
