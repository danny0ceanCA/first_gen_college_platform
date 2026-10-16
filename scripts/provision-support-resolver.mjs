import {pathToFileURL} from 'node:url';
import {telemetryPool} from '../ops/observability/config.mjs';
import {grantSupportResolver} from '../server/support-diagnostics-grants.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let pool;try{pool=telemetryPool(process.env,'APPLICATION_SUPPORT_MIGRATION_DATABASE_URL');await grantSupportResolver(pool,process.env.SUPPORT_RESOLVER_ROLE);}catch{process.stderr.write('Support resolver provisioning failed.\n');process.exitCode=1;}finally{await pool?.end();}}
