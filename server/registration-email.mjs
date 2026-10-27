import {readFileSync} from 'node:fs';
import {guardianMailConfig} from './guardian-email.mjs';
import {renderRegistrationEmail} from './registration-email-template.mjs';
const logo=readFileSync(new URL('./assets/origen-mark.png',import.meta.url)).toString('base64');
export function registrationMailConfig(env={}){
 return guardianMailConfig({...env,GUARDIAN_EMAIL_TRANSPORT:env.REGISTRATION_EMAIL_TRANSPORT||env.GUARDIAN_EMAIL_TRANSPORT||'disabled',GUARDIAN_EMAIL_FROM:env.REGISTRATION_EMAIL_FROM||env.GUARDIAN_EMAIL_FROM,GUARDIAN_EMAIL_REPLY_TO:env.REGISTRATION_EMAIL_REPLY_TO||env.GUARDIAN_EMAIL_REPLY_TO,GUARDIAN_PUBLIC_URL:env.REGISTRATION_PUBLIC_URL||env.GUARDIAN_PUBLIC_URL});
}
export function createRegistrationMailer(env={},request=fetch){
 const config=registrationMailConfig(env);
 return {mode:config.mode,async send(item){
  if(config.mode==='disabled')return 'disabled';
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(item.recipient)||item.recipient.length>254)return 'failed';
  const message=renderRegistrationEmail({...item,publicURL:config.publicURL});
  try{const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`registration-${item.id}`},body:JSON.stringify({from:`Daniel at Origen Edu <${config.from}>`,to:[item.recipient],reply_to:config.replyTo,...message,attachments:[{filename:'origen-mark.png',content:logo,content_id:'origen-mark',content_type:'image/png'}]}),signal:AbortSignal.timeout(10000)});return response.ok?'accepted':'failed';}catch{return 'failed';}
 }};
}
export async function assertRegistrationEmailReady(database,env){
 if(registrationMailConfig(env).mode==='disabled')return;
 if(!database||(await database.query("SELECT to_regprocedure('origen_registration_email_delivery(jsonb)') AS fn")).rows[0]?.fn==null)throw new Error('registration_email_migration_required');
 if(!(await database.query("SELECT has_function_privilege(current_user,'origen_registration_email_delivery(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('registration_email_maintenance_grant_required');
}
export function startRegistrationEmailWorker({database,env={},mailer=createRegistrationMailer(env),intervalMs=15000,onError=()=>{}}){
 if(mailer.mode==='disabled')return async()=>{};
 let stopped=false,active;
 async function sweep(){
  try{for(let i=0;i<10&&!stopped;i++){
   const item=(await database.query('SELECT origen_registration_email_delivery($1::jsonb) AS result',[JSON.stringify({action:'claim'})])).rows[0]?.result;
   if(!item?.id)break;
   let outcome;try{outcome=await mailer.send(item);}catch{outcome='failed';}
   await database.query('SELECT origen_registration_email_delivery($1::jsonb) AS result',[JSON.stringify({action:'finish',id:item.id,leaseToken:item.leaseToken,accepted:outcome==='accepted'})]);
  }}catch{onError();}
 }
 const tick=()=>{if(!stopped&&!active)active=sweep().finally(()=>{active=undefined;});};
 tick();const timer=setInterval(tick,intervalMs);timer.unref?.();
 return async()=>{stopped=true;clearInterval(timer);await active;};
}
