import {createHash,randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {personalizationPolicy} from './personalization-controls.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;
export function voicePreparationKey(input){
 const {action,sdp,preparedContextId,...rest}=input;
 return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');
}
export async function voiceContextVersion(database,subject){
 if(!database)return undefined;
 const c=await database.connect();
 try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  if(!(await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_voice_context_versions'")).rows.length){await c.query('COMMIT');return undefined;}
  const row=(await c.query('SELECT coalesce(v.revision,0)::text AS revision FROM origen_accounts a LEFT JOIN origen_voice_context_versions v ON v.account_id=a.id WHERE a.auth0_subject=$1',[subject])).rows[0];
  await c.query('COMMIT');return row?.revision;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export function voicePreparationCache(env,{now=Date.now,ttlMs=12000}={}){
 const entries=new Map();
 const remove=id=>{clearTimeout(entries.get(id)?.timer);entries.delete(id);};
 const prune=()=>{for(const [id,e] of entries)if(e.expires<=now())remove(id);};
 return {
  put(subject,key,revision,input){
   prune();if(revision===undefined)return undefined;
   for(const [id,e] of entries)if(e.subject===subject)remove(id);
   while(entries.size>=32)remove(entries.keys().next().value);
   const id=randomUUID(),timer=setTimeout(()=>remove(id),ttlMs);timer.unref?.();entries.set(id,{subject,key,revision,input:structuredClone(input),policy:personalizationPolicy(env,subject),expires:now()+ttlMs,timer});return id;
  },
  take(subject,id,key,revision){
   prune();const e=entries.get(id);if(!e||e.subject!==subject)return undefined;
   remove(id);
   if(e.key!==key||e.revision!==revision||e.policy!==personalizationPolicy(env,subject))return undefined;
   return structuredClone(e.input);
  },
 };
}
