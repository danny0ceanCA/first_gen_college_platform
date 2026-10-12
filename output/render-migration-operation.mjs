import pg from 'pg';
import {rootCertificates} from 'node:tls';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createCipheriv} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {migrateDatabase,databaseReady} from '../server/database.mjs';
import {grantRuntimeAccess} from '../server/runtime-grants.mjs';
import {assertRuntimeIsolation,isolateDatabase} from '../server/account-isolation.mjs';

const service='srv-db02or0u01pc738ktekg',database='dpg-db0806hsrm7s73efcupg-a';
const headers={Authorization:`Bearer ${process.env.RENDER_API_KEY}`,'Content-Type':'application/json'};
async function api(path,options={}){const r=await fetch(`https://api.render.com/v1${path}`,{...options,headers});if(!r.ok)throw new Error(`render_api_${r.status}`);return r.status===204?null:r.json();}
function processBytes(exe,args,input,env=process.env){return new Promise((resolve,reject)=>{const p=spawn(exe,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks=[];p.stdout.on('data',x=>chunks.push(x));p.stderr.resume();p.on('error',()=>reject(new Error('operator_process_failed')));p.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(`operator_process_exit_${code}`)));p.stdin.end(input);});}
async function protect(bytes){const code="Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))";return (await processBytes('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],bytes.toString('base64'))).toString();}
const folder=new URL('./private-db-backups/',import.meta.url);await mkdir(folder,{recursive:true});await writeFile(new URL('.gitignore',folder),'*\n');
const stamp=new Date().toISOString().replaceAll(':','-');
let pool;
try{
 const info=await api(`/postgres/${database}/connection-info`);
 const envRows=await api(`/services/${service}/env-vars?limit=100`);
 const env=envRows.map(x=>x.envVar);
 const recovery=await api(`/postgres/${database}/recovery`);
 console.log(JSON.stringify({phase:'recovery',...recovery}));
 const url=new URL(info.externalConnectionString);
 if(url.pathname!=='/origen_edu_database'||!url.hostname.startsWith(database.replace(/-a$/,'')))throw new Error('wrong_database');
 pool=new pg.Pool({connectionString:url.href,ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:10000});
 const before=await pool.query('SELECT name FROM origen_schema_migrations ORDER BY name');
 const counts=await pool.query('SELECT (SELECT count(*) FROM origen_accounts)::int AS accounts,(SELECT count(*) FROM origen_students)::int AS students,(SELECT count(*) FROM origen_conversation_summaries)::int AS summaries');
 console.log(JSON.stringify({phase:'preflight',latestMigration:before.rows.at(-1)?.name,counts:counts.rows[0]}));
 const caFile=new URL('trusted-root-certificates.pem',folder);await writeFile(caFile,rootCertificates.join('\n'));
 const dumpEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:'verify-full',PGSSLROOTCERT:fileURLToPath(caFile)};
 const dump=await processBytes('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',['--format=custom','--no-owner','--no-acl'],undefined,dumpEnv);
 const listing=await processBytes('C:/Program Files/PostgreSQL/18/bin/pg_restore.exe',['--list'],dump);
 if(!listing.toString().includes('origen_accounts'))throw new Error('invalid_backup');
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(dump),cipher.final()]);
 await writeFile(new URL(`origen-${stamp}.enc`,folder),ciphertext);
 await writeFile(new URL(`origen-${stamp}.json`,folder),JSON.stringify({format:'pg_dump custom / AES-256-GCM / Windows DPAPI CurrentUser',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),protectedKey:await protect(key)}));
 console.log(JSON.stringify({phase:'backup',verifiedArchive:true,encrypted:true,bytes:dump.length}));
 if(process.argv[2]!=='apply')process.exitCode=0;
 else{
  await migrateDatabase(pool);
  console.log(JSON.stringify({phase:'migrations',latest:(await pool.query('SELECT name FROM origen_schema_migrations ORDER BY name DESC LIMIT 1')).rows[0].name}));
  const role='origen_api';
  if((await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw new Error('runtime_role_already_exists');
  const password=randomBytes(32).toString('hex');
  const runtimeExternal=new URL(info.externalConnectionString),runtimeInternal=new URL(info.internalConnectionString);
  for(const u of [runtimeExternal,runtimeInternal]){u.username=role;u.password=password;for(const k of ['sslmode','ssl'])u.searchParams.delete(k);}
  await writeFile(new URL(`runtime-${stamp}.dpapi`,folder),await protect(Buffer.from(JSON.stringify({role,external:runtimeExternal.href,internal:runtimeInternal.href}))));
  await pool.query(`CREATE ROLE origen_api LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  await grantRuntimeAccess(pool,role);
  const runtime=new pg.Pool({connectionString:runtimeExternal.href,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000});
  try{await assertRuntimeIsolation(runtime);if(!await databaseReady(isolateDatabase(runtime)))throw new Error('runtime_schema_not_ready');console.log(JSON.stringify({phase:'runtime',isolationVerified:true}));}finally{await runtime.end();}
  const after=await pool.query('SELECT (SELECT count(*) FROM origen_accounts)::int AS accounts,(SELECT count(*) FROM origen_students)::int AS students,(SELECT count(*) FROM origen_conversation_summaries)::int AS summaries');
  if(JSON.stringify(counts.rows[0])!==JSON.stringify(after.rows[0]))throw new Error('record_counts_changed');
  const updates={DATABASE_URL:runtimeInternal.href,DATABASE_TLS_MODE:'render-internal',NODE_ENV:'production'};
  const next=env.filter(x=>x.key!=='MIGRATION_DATABASE_URL').map(x=>({key:x.key,value:updates[x.key]??x.value}));
  for(const [key,value] of Object.entries(updates))if(!next.some(x=>x.key===key))next.push({key,value});
  await api(`/services/${service}/env-vars`,{method:'PUT',body:JSON.stringify(next)});
  console.log(JSON.stringify({phase:'cutover',backendRuntimeUpdated:true,migrationCredentialExcluded:true,countsPreserved:after.rows[0]}));
 }
}catch(error){console.error(JSON.stringify({phase:'failed',code:error.code||error.message?.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')}));process.exitCode=1;}finally{await pool?.end();}

