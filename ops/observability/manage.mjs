import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {serverEvents,clientSchemas,enumFields,numericFields,endpoints} from '../../server/observability/event-catalog.mjs';
import {technicalCodes} from '../../server/observability/error-codes.mjs';
import {responseCodes} from '../../server/observability/response-codes.mjs';
import {clientCodes} from '../../server/observability/event-catalog.mjs';
import {dependencyOperations,jobNames} from '../../server/observability/metrics.mjs';
import {telemetryPool} from './config.mjs';
const identifier=value=>{if(!/^[a-z_][a-z0-9_]{0,52}$/.test(value))throw new Error('invalid_telemetry_role');return `"${value}"`;};
const enums=values=>({kind:'enum',values:[...new Set(values)]});
const number=(max,integer=true)=>({kind:'number',max,integer});
export function eventContracts(){
 const envelope={schemaVersion:number(1),eventId:{kind:'uuid'},time:{kind:'time'},service:enums(['origen-api']),environment:enums(['production','staging','test','development']),release:{kind:'hex',pattern:'^(unknown|[a-f0-9]{40}|[a-f0-9]{64})$'},instanceId:{kind:'uuid'},event:enums([...Object.keys(serverEvents),...Object.keys(clientSchemas)]),level:enums(['info','warn','error']),producer:enums(['server','browser']),evidence:enums(['server_observed','client_reported']),requestId:{kind:'uuid'},operationId:{kind:'uuid'},endpoint:enums([...endpoints,'unknown_route']),method:enums(enumFields.method),traceId:{kind:'hex',pattern:'^[a-f0-9]{32}$'},spanId:{kind:'hex',pattern:'^[a-f0-9]{16}$'},parentSpanId:{kind:'hex',pattern:'^[a-f0-9]{16}$'}};
 const required=['schemaVersion','eventId','time','service','environment','release','instanceId','event','level','producer','evidence'];const result=[];
 for(const [producer,catalog] of [['server',serverEvents],['browser',clientSchemas]])for(const [event,spec] of Object.entries(catalog)){
  const rules={...envelope,event:enums([event]),producer:enums([producer]),evidence:enums([producer==='browser'?'client_reported':'server_observed'])};
  for(const key of spec.fields)rules[key]=key==='code'?enums(producer==='browser'?clientCodes:[...technicalCodes,...responseCodes,...clientCodes]):Object.hasOwn(enumFields,key)?enums(enumFields[key]):number(numericFields[key],key!=='samplingProbability');
  result.push({event,producer,rules,required});
 }
 const rules={schemaVersion:number(1),instanceId:{kind:'uuid'},sequence:number(Number.MAX_SAFE_INTEGER),interval:{kind:'time'},environment:envelope.environment,service:envelope.service,family:enums(['api','provider','database','job']),operation:enums([...endpoints,'unknown_route',...dependencyOperations,...jobNames]),outcome:enums(['completed','failed','cancelled','unknown','skipped-lock']),count:number(10000000),sumMs:number(6000000000000,false),buckets:{kind:'histogram'},coverage:enums(['complete','partial'])};
 result.push({event:'__metric__',producer:'server',rules,required:Object.keys(rules)});return result;
}
export async function migrateTelemetry(pool,{ledger=false}={}){
 const directory=new URL(ledger?'./ledger-migrations/':'./migrations/',import.meta.url),client=await pool.connect();
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728423,1)');await client.query('CREATE TABLE IF NOT EXISTS telemetry_migrations(name text PRIMARY KEY,checksum text NOT NULL)');
  for(const name of (await readdir(directory)).filter(n=>/^\d{3}_[a-z_]+\.sql$/.test(n)).sort()){
   const sql=(await readFile(new URL(name,directory),'utf8')).replaceAll('\r\n','\n'),checksum=createHash('sha256').update(sql).digest('hex'),existing=(await client.query('SELECT checksum FROM telemetry_migrations WHERE name=$1',[name])).rows[0];
   if(existing){if(existing.checksum!==checksum)throw new Error('telemetry_migration_changed');continue;}
   await client.query(sql);await client.query('INSERT INTO telemetry_migrations VALUES($1,$2)',[name,checksum]);
  }
  if(!ledger)for(const row of eventContracts())await client.query('INSERT INTO telemetry_contract VALUES($1,$2,$3,$4) ON CONFLICT(event,producer) DO UPDATE SET rules=EXCLUDED.rules,required=EXCLUDED.required',[row.event,row.producer,row.rules,row.required]);
  if(!ledger)await client.query('SELECT telemetry_maintain()');await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function grantTelemetryRole(pool,role,purpose,environment){
 const who=identifier(role);if(!['production','staging','test','development'].includes(environment))throw new Error('invalid_telemetry_environment');
 const client=await pool.connect();try{await client.query('BEGIN');
  const r=(await client.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR NOT r.rolcanlogin OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND pg_has_role(r.oid,c.relowner,'MEMBER')) AS unsafe FROM pg_roles r WHERE r.rolname=$1`,[role])).rows[0];if(!r||r.unsafe)throw new Error('restricted_telemetry_role_required');
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${who};GRANT USAGE ON SCHEMA public TO ${who}`);await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${who};REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${who}`);
  const functions={ingest:['telemetry_ingest(jsonb)'],query:[],health:[],monitor:['telemetry_monitor_snapshot()'],retention:['telemetry_maintain()'],erasure:['telemetry_erase(jsonb,bigint)','telemetry_ready(bigint)','telemetry_block()'],ledgerWriter:['ledger_append(jsonb)','ledger_page(bigint,bigint)','ledger_generation()'],ledgerReader:['ledger_generation()'],support:['ledger_generation()','support_environment()','support_audit(uuid,text,text,text)','support_register(uuid,uuid,text,text,text,uuid[],timestamptz)','support_authorized(uuid,text,text)','support_revoke(uuid,text)'],ledgerRetention:['ledger_expire()','ledger_generation()']}[purpose];if(!functions)throw new Error('invalid_telemetry_role');
  for(const fn of functions)await client.query(`GRANT EXECUTE ON FUNCTION ${fn} TO ${who}`);
  if(purpose==='query')await client.query(`GRANT SELECT ON telemetry_events_live,telemetry_metrics_live,telemetry_health TO ${who}`);
  else if(['ingest','retention','erasure','health','monitor'].includes(purpose))await client.query(`GRANT SELECT ON telemetry_health TO ${who}`);
  await client.query(`ALTER ROLE ${who} SET statement_timeout='2s'`);
  await client.query(`INSERT INTO ${(purpose.startsWith('ledger')||purpose==='support')?'ledger_scopes':'telemetry_scopes'} VALUES($1,$2) ON CONFLICT(role_name) DO UPDATE SET environment=EXCLUDED.environment`,[role,environment]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let pool;try{const ledger=process.argv.includes('--ledger');pool=telemetryPool(process.env,ledger?'LEDGER_MIGRATION_DATABASE_URL':'TELEMETRY_MIGRATION_DATABASE_URL');if(process.argv[2]==='migrate')await migrateTelemetry(pool,{ledger});else if(process.argv[2]==='grant')await grantTelemetryRole(pool,process.env.TELEMETRY_ROLE,process.env.TELEMETRY_PURPOSE,process.env.TELEMETRY_ENVIRONMENT);else throw new Error('invalid_telemetry_command');}catch{process.exitCode=1;process.stderr.write('Telemetry provisioning failed.\n');}finally{await pool?.end();}
}
