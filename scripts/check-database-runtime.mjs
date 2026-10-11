import {createDatabase,databaseReady} from '../server/database.mjs';
import {assertRuntimeIsolation} from '../server/account-isolation.mjs';
const pool=createDatabase();
if(!pool)throw new Error('DATABASE_URL is required.');
try{await assertRuntimeIsolation(pool);if(!await databaseReady(pool))throw new Error('database_not_ready');console.log('Origen runtime privilege and schema checks passed.');}
finally{await pool.end();}
