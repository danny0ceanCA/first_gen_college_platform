import {guardAccountTransaction} from './account-guard.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAdmin(subject,env){return (env.ADMIN_SUBJECTS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(subject);}
export function hasAdminAccess(identity,env){return isAdmin(identity?.sub,env)||Array.isArray(identity?.permissions)&&identity.permissions.includes('read:activity');}
export function creditedSeconds(seconds,gap,age){return Math.min(600,seconds+Math.max(0,Math.min(30,gap,600-age)));}
export function createAdminHandler(database,env){
 return async(req,res,next)=>{
  const path=req.url?.split('?')[0];if(!['/api/admin','/api/activity'].includes(path))return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(path==='/api/admin'&&!hasAdminAccess(req.origenIdentity,env))return send(403,{error:'admin_required'});
  if(!database)return send(503,{error:'database_unavailable'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'request_too_large'});}
  let data;try{data=JSON.parse(raw);}catch{return send(400,{error:'invalid_request'});}
  if(path==='/api/admin'){
   if(data.action==='access')return send(200,{admin:true});
   if(data.action!=='overview')return send(400,{error:'invalid_action'});
   const totals=(await database.query(`SELECT
    (SELECT count(*) FROM origen_accounts) AS users,
    (SELECT count(*) FROM origen_accounts WHERE created_at>=now()-interval '30 days') AS new_users,
    (SELECT count(*) FROM origen_login_activity WHERE created_at>=now()-interval '30 days') AS logins,
    (SELECT count(DISTINCT account_id) FROM origen_login_activity WHERE created_at>=now()-interval '30 days') AS active_users,
    (SELECT coalesce(sum(seconds),0)/60 FROM origen_voice_activity WHERE started_at>=now()-interval '30 days') AS voice_minutes,
    (SELECT count(*) FROM origen_voice_activity WHERE started_at>=now()-interval '30 days') AS calls`)).rows[0];
   const users=(await database.query(`SELECT a.id,a.first_name,a.created_at,
    (SELECT count(*) FROM origen_login_activity l WHERE l.account_id=a.id AND l.created_at>=now()-interval '30 days') AS logins,
    (SELECT max(created_at) FROM origen_login_activity l WHERE l.account_id=a.id) AS last_login,
    (SELECT coalesce(sum(seconds),0)/60 FROM origen_voice_activity v WHERE v.account_id=a.id AND v.started_at>=now()-interval '30 days') AS voice_minutes
    FROM origen_accounts a ORDER BY a.created_at DESC LIMIT 200`)).rows;
   const activity=(await database.query(`SELECT * FROM (
    SELECT l.id,l.account_id,a.first_name,'sign_in' AS event,l.created_at AS occurred_at,0::double precision AS minutes,'' AS topic FROM origen_login_activity l JOIN origen_accounts a ON a.id=l.account_id
    UNION ALL SELECT v.id,v.account_id,a.first_name,'voice_call',v.started_at,v.seconds/60,v.topic FROM origen_voice_activity v JOIN origen_accounts a ON a.id=v.account_id
    ) events ORDER BY occurred_at DESC LIMIT 50`)).rows;
   return send(200,{totals,users,activity,measuredSince:(await database.query('SELECT applied_at FROM origen_schema_migrations WHERE name=$1',['017_admin_activity.sql'])).rows[0]?.applied_at});
  }
  if(!uuid.test(data.id||'')||!['login','voice_start','voice_heartbeat','voice_end'].includes(data.action))return send(400,{error:'invalid_activity'});
  if(data.action==='voice_start'&&!['profile','finance','admissions','planning','loans'].includes(data.topic))return send(400,{error:'invalid_topic'});
  const client=await database.connect();
  try{
   await client.query('BEGIN');
   await guardAccountTransaction(client,req.origenIdentity.sub);
   // Serialize a physical call, including duplicate start/end and concurrent heartbeats.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.id]);
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES($1) ON CONFLICT(auth0_subject) DO NOTHING',[req.origenIdentity.sub]);
   const owner=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[req.origenIdentity.sub])).rows[0].id;
   if(data.action==='login')await client.query('INSERT INTO origen_login_activity(id,account_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[data.id,owner]);
   else if(data.action==='voice_start')await client.query('INSERT INTO origen_voice_activity(id,account_id,topic) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[data.id,owner,data.topic]);
   else await client.query(`UPDATE origen_voice_activity SET seconds=least(600,seconds+greatest(0,least(30,extract(epoch FROM now()-last_seen_at),600-extract(epoch FROM last_seen_at-started_at)))),last_seen_at=now(),ended_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1 AND account_id=$2 AND ended_at IS NULL`,[data.id,owner,data.action==='voice_end']);
   await client.query('COMMIT');return send(204,{});
  }catch(error){await client.query('ROLLBACK');if(error.status===403)return send(403,{error:'account_closed'});throw error;}finally{client.release();}
 };
}
