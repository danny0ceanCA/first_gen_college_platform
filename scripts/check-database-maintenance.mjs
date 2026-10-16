import {createMaintenanceDatabase,assertMaintenanceAccess} from '../server/maintenance-database.mjs';
const pool=createMaintenanceDatabase(process.env);
if(!pool)throw new Error('maintenance_database_required');
try{await assertMaintenanceAccess(pool);}finally{await pool.end();}
