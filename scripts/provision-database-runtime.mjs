import {createDatabase} from '../server/database.mjs';
import {grantRuntimeAccess} from '../server/runtime-grants.mjs';

if(!process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_RUNTIME_ROLE)throw new Error('MIGRATION_DATABASE_URL and DATABASE_RUNTIME_ROLE are required. Use a separate existing login without elevated privileges.');
const pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
try{await grantRuntimeAccess(pool,process.env.DATABASE_RUNTIME_ROLE);console.log('Origen runtime grants installed. Verify DATABASE_URL with npm run db:check-runtime.');}
finally{await pool.end();}
