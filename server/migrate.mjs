import {createDatabase,migrateDatabase} from './database.mjs';
import {backfillGuidanceIdentities,guidanceEnabled} from './guidance-history.mjs';

const database=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
if(!database){console.error('MIGRATION_DATABASE_URL is required; the HTTP runtime must use a separate restricted DATABASE_URL.');process.exitCode=1;}
else{
 try{await migrateDatabase(database);if(guidanceEnabled(process.env))await backfillGuidanceIdentities(database,`https://${process.env.AUTH0_DOMAIN}/`,process.env.GUIDANCE_LEGACY_ISSUER===`https://${process.env.AUTH0_DOMAIN}/`);console.log('Origen database migrations are up to date.');}
 catch{console.error('Origen database migration failed. Check database connectivity and migration files.');process.exitCode=1;}
 finally{await database.end();}
}
