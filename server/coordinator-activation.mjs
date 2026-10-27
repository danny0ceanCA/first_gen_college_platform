import {createHash,timingSafeEqual} from 'node:crypto';
import {runIdentityEvents} from './account-isolation.mjs';

const invalid=()=>Object.assign(new Error('invalid_identity_events'),{status:400});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function activationConfiguration(env){
 const secret=env.AUTH0_COORDINATOR_EVENTS_SECRET;
 const clients=(env.AUTH0_COORDINATOR_CLIENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return {enabled:typeof secret==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(secret)&&clients.length>0&&clients.every(x=>/^[A-Za-z0-9_-]{8,128}$/.test(x)),secret,clients};
}

// Accept Auth0 JSONARRAY, JSONLINES and a single log envelope. Persist only
// verified milestones: no emails, IP addresses, tokens or full log payloads.
export function coordinatorIdentityEvents(raw,clients,now=Date.now()){
 let items;
 try{const parsed=JSON.parse(raw);items=Array.isArray(parsed)?parsed:[parsed];}
 catch{try{items=raw.split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));}catch{throw invalid();}}
 if(!items.length||items.length>1000)throw invalid();
 const events=[];
 for(const item of items){
  if(!plain(item))throw invalid();
  const data=Object.hasOwn(item,'data')?item.data:item;
  if(!plain(data))throw invalid();
  if(!['scp','s'].includes(data.type))continue;
  // A successful login to the Auth0 dashboard or another tenant application
  // must never count as an Origen sign-in. Password events are tenant scoped.
  if(data.type==='s'&&!clients.includes(data.client_id))continue;
  const time=typeof data.date==='string'&&/^\d{4}-\d\d-\d\dT/.test(data.date)?Date.parse(data.date):NaN;
  if(typeof data.user_id!=='string'||!data.user_id.trim()||data.user_id.length>255||/[\x00-\x1f\x7f]/.test(data.user_id)||!Number.isFinite(time)||time<Date.UTC(2000,0,1)||time>now+300000)throw invalid();
  events.push({subject:data.user_id,kind:data.type==='scp'?'password-set':'sign-in',occurredAt:new Date(time).toISOString()});
 }
 return events;
}

export function createCoordinatorIdentityHandler(database,env){
 const config=activationConfiguration(env);
 return async(req,res)=>{
  const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(req.method!=='POST')return send(405,'method_not_allowed');
  if(!config.enabled||!database)return send(503,'identity_tracking_unavailable');
  const authorization=req.headers.authorization;
  const digest=value=>createHash('sha256').update(value).digest();
  if(typeof authorization!=='string'||authorization.length>256||!timingSafeEqual(digest(authorization),digest(`Bearer ${config.secret}`)))return send(401,'authentication_required');
  if(!/^application\/(?:json|x-ndjson)(?:;|$)/i.test(req.headers['content-type']||''))return send(415,'json_required');
  try{
   let size=0;const chunks=[];
   for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>1048576)return send(413,'request_too_large');chunks.push(Buffer.from(chunk));}
   const events=coordinatorIdentityEvents(Buffer.concat(chunks).toString('utf8'),config.clients);
   // The whole batch commits together. Retries and out-of-order deliveries
   // preserve the earliest timestamp, including an operator history replay.
   await runIdentityEvents(()=>database.query('SELECT origen_record_coordinator_identity_events($1::jsonb)',[JSON.stringify(events)]));
   return send(200);
  }catch(error){return send(error.status===400?400:503,error.status===400?'invalid_identity_events':'identity_tracking_unavailable');}
 };
}

export async function adminCoordinatorActivation(database,input,env){
 if(typeof input.id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.id))throw Object.assign(new Error('invalid_directory_filter'),{status:400});
 const result=(await database.query('SELECT origen_admin_coordinator_activation($1::uuid) AS result',[input.id])).rows[0]?.result;
 if(!result)throw Object.assign(new Error('coordinator_not_found'),{status:404});
 return {...result,trackingEnabled:activationConfiguration(env).enabled};
}

export async function assertCoordinatorActivationReady(database,env){
 if(!env.AUTH0_COORDINATOR_EVENTS_SECRET&&!env.AUTH0_COORDINATOR_CLIENT_IDS)return;
 if(!activationConfiguration(env).enabled)throw new Error('coordinator_activation_configuration_required');
 const result=(await database.query(`SELECT
  to_regprocedure('origen_record_coordinator_identity_events(jsonb)') IS NOT NULL
  AND to_regprocedure('origen_admin_coordinator_activation(uuid)') IS NOT NULL
  AND has_function_privilege(current_user,to_regprocedure('origen_record_coordinator_identity_events(jsonb)'),'EXECUTE')
  AND has_function_privilege(current_user,to_regprocedure('origen_admin_coordinator_activation(uuid)'),'EXECUTE') AS ready`)).rows[0];
 if(!result?.ready)throw new Error('coordinator_activation_migration_required');
}
