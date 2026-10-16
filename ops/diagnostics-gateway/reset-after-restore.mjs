import {pathToFileURL} from 'node:url';
import {environments} from '../../server/observability/wire.mjs';
import {telemetryPool,separateDatabases} from '../observability/config.mjs';
export async function resetSupportAfterRestore(application,ledger,environment){
 if(!environments.includes(environment))throw Error('invalid_support_restore');
 // Gateway must be stopped. Invalidate independent grants first; if the second
 // write fails, leave access stopped and rerun this idempotent procedure.
 await ledger.query("UPDATE support_grants SET status='revoked' WHERE environment=$1 AND status='active'",[environment]);
 await application.query("UPDATE origen_support_cases SET status='closed' WHERE environment=$1 AND status='open'",[environment]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let application,ledger;try{
 if(process.env.SUPPORT_RESTORE_GATEWAY_STOPPED!=='true')throw Error();
 separateDatabases(process.env,['APPLICATION_SUPPORT_OPERATOR_DATABASE_URL','LEDGER_MIGRATION_DATABASE_URL']);
 application=telemetryPool(process.env,'APPLICATION_SUPPORT_OPERATOR_DATABASE_URL');ledger=telemetryPool(process.env,'LEDGER_MIGRATION_DATABASE_URL');await resetSupportAfterRestore(application,ledger,process.env.TELEMETRY_ENVIRONMENT);
}catch{process.stderr.write('Support restore reset failed. Keep gateway stopped.\n');process.exitCode=1;}finally{await application?.end();await ledger?.end();}}
