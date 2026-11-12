import pg from 'pg';
import {mkdtemp,copyFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {migrateDatabase} from '../server/database.mjs';

// Explicitly scoped migration. Do not alter an unrelated historical checksum
// or automatically run other pending migrations during catalog publication.
if(!process.env.MIGRATION_DATABASE_URL||!process.env.CATALOG_EXPECTED_DATABASE)throw Error('catalog_migration_configuration_required');
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:10000});
let directory;
try{
 const identity=(await pool.query('SELECT current_database() AS name')).rows[0];
 if(identity.name!==process.env.CATALOG_EXPECTED_DATABASE)throw Error('catalog_database_mismatch');
 directory=await mkdtemp(join(tmpdir(),'origen-catalog-migration-'));
 const filename='126_cost_catalog_publication.sql';
 await copyFile(new URL('../server/migrations/'+filename,import.meta.url),join(directory,filename));
 await migrateDatabase(pool,pathToFileURL(directory+'/'));
 console.log('Catalog migration 126 is installed. Historical migrations were not modified.');
}finally{
 await pool.end();
 if(directory){await unlink(join(directory,'126_cost_catalog_publication.sql'));await rmdir(directory);}
}
