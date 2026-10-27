// Operator-only history replay. Uses the existing Auth0 CLI management login;
// never adds a Management API credential to the web app or prints raw logs.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createDatabase} from '../server/database.mjs';
import {isolateDatabase,runIdentityEvents} from '../server/account-isolation.mjs';
import {coordinatorIdentityEvents} from '../server/coordinator-activation.mjs';

export async function syncCoordinatorActivation({owner,database,domain,clients,readLogs}){
 if(!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)||!clients.length)throw Error('activation_replay_configuration_required');
 const rows=(await owner.query(`SELECT r.auth0_subject FROM origen_institution_representatives r
  WHERE EXISTS(SELECT 1 FROM origen_coordinator_applications a WHERE a.auth0_subject=r.auth0_subject)
  AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts c WHERE c.subject_hash=encode(sha256(convert_to(r.auth0_subject,'UTF8')),'hex'))`)).rows;
 let milestones=0;
 for(const {auth0_subject:subject} of rows){
  for(let page=0;;page++){
   // Explicit bounds protect operators from an unbounded historical replay.
   if(page===100)throw Error('activation_replay_page_limit');
   const logs=await readLogs(subject,page);
   if(!Array.isArray(logs)||logs.some(log=>log.user_id!==subject))throw Error('activation_replay_identity_mismatch');
   if(!logs.length)break;
   const events=coordinatorIdentityEvents(JSON.stringify(logs),clients);
   if(events.length){await runIdentityEvents(()=>database.query('SELECT origen_record_coordinator_identity_events($1::jsonb)',[JSON.stringify(events)]));milestones+=events.length;}
   if(logs.length<100)break;
  }
 }
 return {coordinatorsChecked:rows.length,confirmedEvents:milestones,history:'available Auth0 retention only'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let owner;
 try{
  if(!process.env.MIGRATION_DATABASE_URL||!process.env.AUTH0_DOMAIN||!process.env.AUTH0_COORDINATOR_CLIENT_IDS)throw Error('activation_replay_configuration_required');
  owner=createDatabase({...process.env,DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
  const execute=promisify(execFile),cli=process.env.AUTH0_CLI_BIN||'auth0';
  const result=await syncCoordinatorActivation({owner,database:isolateDatabase(owner),domain:process.env.AUTH0_DOMAIN,clients:process.env.AUTH0_COORDINATOR_CLIENT_IDS.split(',').map(x=>x.trim()).filter(Boolean),readLogs:async(subject,page)=>{
   const {stdout}=await execute(cli,['api','get',`users/${encodeURIComponent(subject)}/logs`,'--tenant',process.env.AUTH0_DOMAIN,'-q','fields=type,date,user_id,client_id','-q','include_fields=true','-q','per_page=100','-q',`page=${page}`,'-q','sort=date:1'],{maxBuffer:1048576,timeout:30000});
   return JSON.parse(stdout);
  }});
  console.log(JSON.stringify(result));
 }catch{console.error('Coordinator activation replay failed. Check operator database access, Auth0 read:logs permission, and the application client allowlist. No credentials or raw logs have been printed.');process.exitCode=1;}
 finally{await owner?.end();}
}
