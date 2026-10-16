import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {uuid,environments} from '../../server/observability/wire.mjs';
import {supportPurposes} from '../../server/support-diagnostics.mjs';
import {telemetryPool,assertTelemetryRole} from '../observability/config.mjs';
// Operator-only resolver. Never imported by the HTTP gateway. Its application
// owner credential must not exist in the gateway environment.
export async function createSystemIncident(application,telemetry,{environment,purpose,operations,start,end}){
 if(!environments.includes(environment)||!supportPurposes.includes(purpose)||!Array.isArray(operations)||operations.length<1||operations.length>100||!operations.every(uuid)||new Set(operations).size!==operations.length||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>86400000||Date.parse(end)>Date.now()+60000)throw Error('invalid_support_incident');
 const found=(await telemetry.query('SELECT DISTINCT operation_id FROM telemetry_events_live WHERE environment=$1 AND operation_id=ANY($2::uuid[]) AND event_time BETWEEN $3 AND $4 LIMIT 101',[environment,operations,start,end])).rows;
 if(found.length!==operations.length)throw Error('invalid_support_incident');
 const id=randomUUID();await application.query("INSERT INTO origen_support_cases(id,origin,purpose,environment,operation_ids,window_start,window_end) VALUES($1,'system_incident',$2,$3,$4,$5,$6)",[id,purpose,environment,operations,start,end]);return {caseId:id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let application,telemetry;try{
 if(process.env.SUPPORT_OPERATOR_INCIDENT!=='true')throw Error();
 application=telemetryPool(process.env,'APPLICATION_SUPPORT_OPERATOR_DATABASE_URL');telemetry=telemetryPool(process.env,'TELEMETRY_QUERY_DATABASE_URL');await assertTelemetryRole(telemetry,'query');
 const result=await createSystemIncident(application,telemetry,{environment:process.env.TELEMETRY_ENVIRONMENT,purpose:process.env.SUPPORT_INCIDENT_PURPOSE,operations:(process.env.SUPPORT_INCIDENT_OPERATIONS||'').split(','),start:process.env.SUPPORT_INCIDENT_START,end:process.env.SUPPORT_INCIDENT_END});process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Support incident creation failed.\n');process.exitCode=1;}finally{await application?.end();await telemetry?.end();}}
