import {createDatabase,migrateDatabase} from './database.mjs';

const database=createDatabase();
if(!database){console.error('DATABASE_URL is required to apply database migrations.');process.exitCode=1;}
else{
 try{await migrateDatabase(database);console.log('Origen database migrations are up to date.');}
 catch{console.error('Origen database migration failed. Check database connectivity and migration files.');process.exitCode=1;}
 finally{await database.end();}
}
