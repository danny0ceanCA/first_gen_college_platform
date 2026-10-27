import {useEffect,useState} from 'react';
import {KeyRound,LogIn,RefreshCw} from 'lucide-react';
import {staffVerificationErrors} from './StaffVerification';
import './CoordinatorActivation.css';

type Activation={id:string;passwordSetAt:string|null;firstSignInAt:string|null;trackingStartedAt:string;lastReceivedAt:string|null;trackingEnabled:boolean};
type Request=(input:unknown,signal:AbortSignal)=>Promise<any>;
const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

export default function CoordinatorActivation({id,request,onError}:{id:string;request:Request;onError:(code:string)=>void}){
 const [data,setData]=useState<Activation>(),[error,setError]=useState(false),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();setData(undefined);setError(false);setLoading(true);
  void request({action:'coordinator-activation',id},controller.signal).then(result=>{
   if(!controller.signal.aborted){if(result.id!==id)throw Error('invalid_activation');setData(result);}
  }).catch(e=>{if(!controller.signal.aborted){setError(true);if(staffVerificationErrors.includes(e.message))onError(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[id,request,onError,revision]);
 return <section className="coordinator-activation" aria-label="Account setup and sign-in" aria-busy={loading}>
  <div className="coordinator-activation-heading"><h3>Account setup & sign-in</h3><button className="button outline" disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14}/>Refresh status</button></div>
  {error?<p className="coordinator-activation-message" role="alert">Account setup status is unavailable. Try refreshing status.</p>:!data?<p className="coordinator-activation-message" role="status">Checking account setup…</p>:<>
   <dl className="coordinator-activation-milestones">{([
    {label:'Password setup',value:data.passwordSetAt,complete:'Password set',Icon:KeyRound},
    {label:'First recorded sign-in',value:data.firstSignInAt,complete:'Signed in',Icon:LogIn},
   ]).map(({label,value,complete,Icon})=><div key={label} data-complete={!!value}><dt><Icon size={17}/>{label}</dt><dd><strong>{value?complete:'Not yet recorded'}</strong>{value&&<time dateTime={value} title={new Date(value).toISOString()}>{date(value)}</time>}</dd></div>)}</dl>
   {!data.trackingEnabled&&<p className="coordinator-activation-message" role="status">Live tracking is not enabled. New milestones will appear after the Auth0 connection is enabled.</p>}
   <p className="coordinator-activation-help">Confirmed by Auth0. Dates are shown in your time zone. Only a successful password setup or sign-in marks a milestone complete; sending or opening an email does not.</p>
   <details className="coordinator-activation-history"><summary>About the sign-in history</summary><p>Tracking began {date(data.trackingStartedAt)}. The sign-in date is the earliest available Auth0 record for Origen. Earlier history may be unavailable for existing accounts. “Not yet recorded” means there is no confirmed event in this history; it does not prove an account has never been used.</p>{data.lastReceivedAt&&<p>Last Auth0 event batch received: {date(data.lastReceivedAt)}.</p>}</details>
  </>}
 </section>;
}
