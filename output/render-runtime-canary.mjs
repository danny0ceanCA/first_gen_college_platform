import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {assertRuntimeIsolation} from '../server/account-isolation.mjs';
const headers={Authorization:`Bearer ${process.env.RENDER_API_KEY}`};
async function get(path){const r=await fetch('https://api.render.com/v1'+path,{headers});if(!r.ok)throw new Error('render_metadata_unavailable');return r.json();}
const env=await get('/services/srv-db02or0u01pc738ktekg/env-vars?limit=100');
const info=await get('/postgres/dpg-db0806hsrm7s73efcupg-a/connection-info');
const url=new URL(env.find(x=>x.envVar.key==='DATABASE_URL').envVar.value);url.hostname=new URL(info.externalConnectionString).hostname;
const pool=new pg.Pool({connectionString:url.href,ssl:{rejectUnauthorized:true},max:1});
let client;
try{
 await assertRuntimeIsolation(pool);client=await pool.connect();await client.query('BEGIN');
 const subjects=[`migration-canary:${randomUUID()}`,`migration-canary:${randomUUID()}`],ids=[];
 for(const sub of subjects){await client.query("SELECT set_config('origen.subject',$1,true),set_config('origen.purpose','account',true)",[sub]);const account=await client.query("INSERT INTO origen_accounts(auth0_subject,first_name) VALUES($1,'Synthetic migration check') RETURNING id",[sub]);ids.push(account.rows[0].id);await client.query("INSERT INTO origen_students(account_id,id,name) VALUES($1,'canary-student','Synthetic profile')",[ids.at(-1)]);await client.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) VALUES($1,'canary-summary','canary-student','profile','Synthetic verification only',now())",[ids.at(-1)]);}
 await client.query("SELECT set_config('origen.subject',$1,true)",[subjects[0]]);
 const visible=await client.query('SELECT account_id FROM origen_conversation_summaries');if(visible.rowCount!==1||visible.rows[0].account_id!==ids[0])throw new Error('scope_read_failed');
 const foreign=await client.query("UPDATE origen_conversation_summaries SET summary='Synthetic foreign update' WHERE account_id=$1",[ids[1]]);if(foreign.rowCount!==0)throw new Error('scope_update_failed');
 await client.query('SAVEPOINT denied_insert');let denied=false;try{await client.query("INSERT INTO origen_students(account_id,id,name) VALUES($1,'foreign-canary','Synthetic profile')",[ids[1]]);}catch(e){denied=e.code==='42501';}await client.query('ROLLBACK TO SAVEPOINT denied_insert');if(!denied)throw new Error('scope_insert_failed');
 await client.query('ROLLBACK');const cleared=await client.query('SELECT count(*)::int AS n FROM origen_conversation_summaries');if(cleared.rows[0].n!==0)throw new Error('context_reset_failed');
 console.log(JSON.stringify({runtimeIsolation:true,twoAccountReadIsolation:true,foreignWriteDenied:true,pooledContextCleared:true,syntheticRecordsRolledBack:true}));
}catch(e){await client?.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({code:e.code||e.message}));process.exitCode=1;}finally{client?.release();await pool.end();}
