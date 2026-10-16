import {createDatabase} from '../server/database.mjs';
import {grantErasureWorker} from '../server/telemetry-erasure-grants.mjs';
let pool;try{if(!process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_ERASURE_ROLE)throw new Error('erasure_provisioning_configuration_required');pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});await grantErasureWorker(pool,process.env.DATABASE_ERASURE_ROLE,{healthOnly:process.argv.includes('--health-only')});}catch{process.stderr.write('Telemetry erasure provisioning failed.\n');process.exitCode=1;}finally{await pool?.end();}
