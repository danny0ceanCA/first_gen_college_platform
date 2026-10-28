import {useEffect,useState} from 'react';

type Event={id:string;created_at:string;operation:string;topic:string;language:string;model:string;resolved_model:string|null;availability:string;outcome:string;entries:{id:string;revision:number;title:string}[]};
type Counts={lookups:number;matched:number;accepted:number;prepared:number;failed:number;unavailable:number};
type Activity={days:number;summary:Counts;allTime:Counts&{since:string|null};events:Event[]};
const operations:Record<string,string>={voice_start:'Voice call started',voice_update:'Voice guide updated',finance_lookup:'Financial-aid research',admissions_lookup:'College and transfer research'};

export default function TeachingLibraryActivity({id,request}:{id?:string;request:(input:unknown)=>Promise<Activity>}){
 const [data,setData]=useState<Activity|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError(false);setData(null);
  void request({action:'activity',...(id?{id}:{})}).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError(true);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[id,request,refresh]);
 return <section className="teaching-activity" aria-label={id?'Activity for this teaching':'Library activity'} aria-busy={loading}>
  <header><div><h3>{id?'Activity for this teaching':'Library activity'}</h3><p className="teaching-help">Past 30 days · Latest 100 requests · Times shown in your local time</p></div><button className="button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh activity</button></header>
  <p className="teaching-help">Shows which published teachings were selected for a model request. An accepted request confirms the API received it; it does not prove the model used the teaching in its answer. Live guide updates are prepared for the app and are not confirmed by the model API. No student names, questions, or conversation text are recorded here.</p>
  {loading&&<p role="status">Loading library activity…</p>}
  {error&&<p className="teaching-error" role="alert">Activity could not load. Try refreshing. If this is a new installation, apply the teaching activity migration and runtime permissions.</p>}
  {data&&<>
   <div className="teaching-activity-all-time"><strong>{data.allTime.lookups.toLocaleString()}</strong><div><b>{id?'All-time accesses to this teaching':'All-time library lookups'}</b><p className="teaching-help">{data.allTime.since?`Tracking since ${new Date(data.allTime.since).toLocaleDateString()}. `:''}Totals remain after older request details expire. Earlier activity is not included.</p></div></div>
   <h4>Past 30 days</h4>
   <div className="teaching-activity-stats"><div><strong>{data.summary.lookups}</strong><span>Library lookups</span></div><div><strong>{data.summary.matched}</strong><span>With matching teachings</span></div><div><strong>{data.summary.accepted}</strong><span>With teachings · API accepted</span></div><div><strong>{data.summary.prepared}</strong><span>With teachings · Guide prepared</span></div></div>
   {!!(data.summary.failed||data.summary.unavailable)&&<p className="teaching-help">{data.summary.failed} failed model requests · {data.summary.unavailable} unavailable library lookups. These counts can overlap.</p>}
   {!data.events.length?<p className="teaching-empty">{id?'No activity recorded for this teaching in the past 30 days.':'No library activity recorded yet. Start a new Origen conversation or a relevant research lookup after tracking is enabled.'}</p>:<ol className="teaching-activity-events">{data.events.map(event=><li key={event.id}>
    <div className="teaching-activity-heading"><strong>{operations[event.operation]||event.operation}</strong><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></div>
    <p>{event.resolved_model||event.model}{event.resolved_model&&event.resolved_model!==event.model?` (requested ${event.model})`:''} · {event.topic} · {event.language==='es'?'Spanish':'English'}</p>
    <span className="teaching-activity-outcome">{event.outcome==='provider_accepted'?'Request accepted by model API':event.outcome==='prepared'?'Guide prepared for app':'Model request failed'}</span>
    {event.availability==='unavailable'?<p>Library unavailable; Origen continued without library references.</p>:event.entries.length?<ul>{event.entries.map(entry=><li key={`${entry.id}:${entry.revision}`}>{entry.title} <small>Published revision {entry.revision}</small></li>)}</ul>:<p>No matching published teachings.</p>}
   </li>)}</ol>}
  </>}
 </section>;
}
