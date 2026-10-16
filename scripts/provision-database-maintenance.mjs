import {createDatabase} from '../server/database.mjs';
import {grantMaintenanceAccess} from '../server/maintenance-database.mjs';
if(!process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_MAINTENANCE_ROLE)throw new Error('maintenance_provisioning_configuration_required');
const pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
try{await grantMaintenanceAccess(pool,process.env.DATABASE_MAINTENANCE_ROLE);}finally{await pool.end();}
