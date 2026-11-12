import {createHash,randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {personalizationPolicy} from './personalization-controls.mjs';
import {voicePreparationSignature} from '../src/voicePreparationScope.mjs';
export const preparationTtlMs=60000;
export function voicePreparationKey(input){
 return createHash('sha256').update(voicePreparationSignature(input)).digest('hex');
}
// No call controls, live tokens, prompts, consent or opening claims are cached.
export function preparedVoiceContext(input){
 return Object.fromEntries(['caller','role','profile','students','experience','memory','plans','studentBrief','workspace','historicalEvidence','returnContext','housingPlan'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
}
export async function voiceContextVersion(database,subject,{forPreparation=false}={}){
 if(!database)return undefined;
 const c=await database.connect();
 try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  if(!(await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_voice_context_versions'")).rows.length){await c.query('COMMIT');return undefined;}
  const row=(await c.query('SELECT coalesce(v.revision,0)::text AS revision, EXISTS(SELECT 1 FROM origen_student_links l WHERE l.member_account_id=a.id) AS linked_profile FROM origen_accounts a LEFT JOIN origen_voice_context_versions v ON v.account_id=a.id WHERE a.auth0_subject=$1',[subject])).rows[0];
  // A linked profile's owner revision is not propagated to this account. Until
  // that dependency is versioned, assemble these contexts fresh on every call.
  await c.query('COMMIT');return forPreparation&&row?.linked_profile?undefined:row?.revision;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export function voicePreparationCache(env,{now=Date.now,ttlMs=preparationTtlMs}={}){
 const entries=new Map();
 const remove=id=>{clearTimeout(entries.get(id)?.timer);entries.delete(id);};
 const prune=()=>{for(const [id,e] of entries)if(e.expires<=now())remove(id);};
 return {
  put(subject,key,revision,input){
   prune();if(revision===undefined)return undefined;
   for(const [id,e] of entries)if(e.subject===subject&&e.key===key)remove(id);
   const owned=[...entries].filter(([,e])=>e.subject===subject);
   while(owned.length>=3)remove(owned.shift()[0]);
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
