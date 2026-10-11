import {useAdminAction} from './AdminPermissions';
import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
type Scope={page:number;search:string;status:string};
type Snapshot={id:string;created_at:string;month:string;rows:number;filters:Scope};
type List={items:Snapshot[];total:number;page:number;pageSize:number;retentionDays:number};
export default function AdminInstitutionSnapshots({scope,revision,disabled,onDenied}:{scope:Scope;revision:number;disabled:boolean;onDenied:()=>void}){
 const canWrite=useAdminAction('institution-snapshot-save');
 const {getAccessTokenSilently}=useAuth0(),[data,setData]=useState<List>(),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),version=useRef(0),saving=useRef(false),pending=useRef<{scope:string;id:string}|null>(null);
 async function request(input:object,signal:AbortSignal){
  const token=await getAccessTokenSilently();if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const r=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal});
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if([401,403].includes(r.status)){onDenied();throw Error('Admin access is required.');}
  if(!r.ok)throw Error(r.status===404?'This snapshot is no longer available.':r.status===409?'Could not save this snapshot. It may have reached the 500-snapshot limit. Refresh and try again.':'Snapshot reporting could not complete. Please try again.');
  return r.json();
 }
 useEffect(()=>{
  version.current++;controller.current?.abort();saving.current=false;setBusy(false);setData(undefined);setError('');
  const c=new AbortController();controller.current=c;
  void request({action:'institution-snapshots',page},c.signal).then(d=>{if(!c.signal.aborted){if(page>1&&(page-1)*20>=d.total)setPage(Math.max(1,Math.ceil(d.total/20)));else setData(d);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});
  return()=>{version.current++;controller.current?.abort();};
 },[page,retry,revision,scope.page,scope.search,scope.status]);
 async function perform(id?:string){
  if(saving.current||disabled)return;saving.current=true;setBusy(true);setError('');setNotice('');
  controller.current?.abort();const c=new AbortController();controller.current=c;const v=version.current;
  try{
   if(id){
    const report=await request({action:'institution-snapshot',id},c.signal);if(c.signal.aborted||v!==version.current)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`origen-internal-institutions-${report.month}-${id}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }else{
    const key=JSON.stringify(scope);if(pending.current?.scope!==key)pending.current={scope:key,id:crypto.randomUUID()};
    await request({action:'institution-snapshot-save',...scope,requestKey:pending.current.id},c.signal);if(c.signal.aborted||v!==version.current)return;
    pending.current=null;setNotice('Snapshot saved. It contains the current filtered page, with fresh server counts and definitions.');setPage(1);setRetry(x=>x+1);
   }
  }catch(e){if(!c.signal.aborted&&v===version.current)setError(e instanceof Error?e.message:'Could not complete this action.');}
  finally{if(v===version.current){saving.current=false;setBusy(false);}}
 }
 return <section className="admin-panel admin-snapshots"><div className="admin-panel-heading"><div><h2>Saved monthly reports</h2><p>Internal snapshots · 90-day retention</p></div><button className="admin-refresh" disabled={disabled||busy||!data||!canWrite} onClick={()=>void perform()}>{busy?'Working…':'Save this report page'}</button></div>
 <p className="admin-funnel-note">Save up to 25 institution rows from the current filters. Snapshots preserve suppressed monthly counts and definitions as they were saved. They contain no personal progress or conversation content and do not authorize external research sharing.</p>
 {notice&&<p role="status" className="admin-funnel-note">{notice}</p>}{error&&<div className="admin-error" role="alert">{error} <button disabled={busy} onClick={()=>setRetry(x=>x+1)}>Retry snapshots</button></div>}
 {!data&&!error?<p role="status" className="admin-funnel-note">Loading snapshots…</p>:data?.items.length?<><ul className="admin-snapshot-list">{data.items.map(row=><li key={row.id}><div><strong>{row.month} · page {row.filters.page}</strong><span>{row.rows} institution rows · {new Date(row.created_at).toLocaleString()}</span><small>Filter: {row.filters.status}{row.filters.search?` · “${row.filters.search}”`:' · all names'}</small></div><button className="admin-refresh" disabled={busy||disabled} aria-label={`Download snapshot ${row.id}`} onClick={()=>void perform(row.id)}>Download JSON</button></li>)}</ul><div className="admin-pagination"><span>{data.total} saved reports</span><div><button disabled={page===1||busy} onClick={()=>setPage(x=>x-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(data.total/20))}</span><button disabled={page*20>=data.total||busy} onClick={()=>setPage(x=>x+1)}>Next</button></div></div></>:data&&<p className="admin-funnel-note">No saved reports yet. Save a snapshot when you want to keep a monthly review.</p>}
 </section>;
}
