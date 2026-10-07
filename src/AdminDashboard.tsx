import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useState} from 'react';
import {apiFetch} from './api';
import './admin.css';
type User={id:string;first_name:string;created_at:string;logins:string;last_login:string|null;voice_minutes:string};
type Activity={id:string;account_id:string;first_name:string;event:string;occurred_at:string;minutes:number;topic:string};
type Overview={totals:Record<string,string>;users:User[];activity:Activity[];measuredSince?:string};
const number=(value:unknown)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1});
const date=(value:string|null)=>value?new Date(value).toLocaleString():'—';
export function AdminLink(){const {getAccessTokenSilently}=useAuth0();const [allowed,setAllowed]=useState(false);useEffect(()=>{let active=true;void getAccessTokenSilently().then(token=>apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'})})).then(r=>{if(active)setAllowed(r.ok);}).catch(()=>{});return()=>{active=false;};},[]);return allowed?<a href="#admin">Admin dashboard</a>:null;}
export default function AdminDashboard(){
 const {getAccessTokenSilently}=useAuth0();
 const [data,setData]=useState<Overview>();const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 async function load(){setLoading(true);setError('');try{const token=await getAccessTokenSilently();const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'overview'})});if(!response.ok)throw new Error(response.status===403?'This account does not have admin access.':'Activity could not load. Try again.');setData(await response.json());}catch(e){setError(e instanceof Error?e.message:'Activity could not load.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 return <main className="admin-dashboard"><header><a href="#app">← Back to Origen</a><h1>Origen activity</h1><button onClick={()=>void load()} disabled={loading}>{loading?'Loading…':'Refresh'}</button></header>
 {error&&<p role="alert">{error}</p>}{data&&<><p>Usage totals cover the last 30 days. Registered users counts all current app accounts, including unfinished onboarding.</p><div className="admin-stats">{[['Registered users','users'],['New users · 30 days','new_users'],['App sign-ins · 30 days','logins'],['Users signing in · 30 days','active_users'],['Connected voice minutes · 30 days','voice_minutes'],['Voice calls · 30 days','calls']].map(([label,key])=><article key={key}><span>{label}</span><strong>{number(data.totals[key])}</strong></article>)}</div>
 <p className="small-text">Tracking began {date(data.measuredSince||null)}. Sign-ins count successful web sign-in returns, not page refreshes. Voice minutes measure connection time, including listening and pauses, rather than speaking time. Dropped connections stop accruing after the last heartbeat; totals may miss up to 15 seconds. Historical usage is not reconstructed.</p>
 <h2>Users</h2><p>Newest 200 accounts. Usage columns cover 30 days.</p><div className="admin-table"><table><thead><tr><th>User</th><th>Registered</th><th>Sign-ins</th><th>Voice minutes</th><th>Last sign-in</th></tr></thead><tbody>{data.users.map(user=><tr key={user.id}><td>{user.first_name||'Onboarding incomplete'}<small>{user.id}</small></td><td>{date(user.created_at)}</td><td>{number(user.logins)}</td><td>{number(user.voice_minutes)}</td><td>{date(user.last_login)}</td></tr>)}</tbody></table></div>
 <h2>Recent activity</h2><p>Latest 50 sign-ins and calls. Conversation content is private.</p><div className="admin-table"><table><thead><tr><th>User</th><th>Activity</th><th>When</th><th>Minutes</th></tr></thead><tbody>{data.activity.map(item=><tr key={item.id}><td>{item.first_name||'Onboarding incomplete'}</td><td>{item.event==='sign_in'?'Sign-in':`Voice · ${item.topic}`}</td><td>{date(item.occurred_at)}</td><td>{item.event==='sign_in'?'—':number(item.minutes)}</td></tr>)}</tbody></table></div></>}
 </main>;
}
