import pg from 'pg';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';

const migrationDirectory=new URL('./migrations/',import.meta.url);

export function createDatabase(env=process.env,Pool=pg.Pool){
 if(!env.DATABASE_URL?.trim())return null;
 // Five connections per API instance leaves room on the small Render database.
 // pg respects SSL settings in the URL. Use Render's internal URL in production.
 const pool=new Pool({connectionString:env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000});
 pool.on('error',()=>console.error('Origen database connection error.'));
 return pool;
}

export async function migrateDatabase(pool,directory=migrationDirectory){
 const files=(await readdir(directory)).filter(name=>/^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
 const migrations=await Promise.all(files.map(async name=>{const sql=(await readFile(new URL(name,directory),'utf8')).replaceAll('\r\n','\n');return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};}));
 const client=await pool.connect();
 let transaction=false;
 try{
  await client.query('BEGIN');transaction=true;
  // Serializes migrations across overlapping deploys and multiple API instances.
  await client.query('SELECT pg_advisory_xact_lock(728419, 1)');
  await client.query('CREATE TABLE IF NOT EXISTS origen_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const {rows}=await client.query('SELECT name, checksum FROM origen_schema_migrations');
  const applied=new Map(rows.map(row=>[row.name,row.checksum]));
  for(const migration of migrations){
   if(applied.has(migration.name)){
    if(applied.get(migration.name)!==migration.checksum)throw new Error('Applied database migration was changed; add a new migration instead.');
    continue;
   }
   await client.query(migration.sql);
   await client.query('INSERT INTO origen_schema_migrations (name, checksum) VALUES ($1, $2)',[migration.name,migration.checksum]);
  }
  await client.query('COMMIT');transaction=false;
 }catch(error){
  if(transaction)await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}

export async function databaseReady(pool){
 if(!pool)return false;
 try{
  const {rows}=await pool.query("SELECT EXISTS (SELECT 1 FROM origen_schema_migrations WHERE name = '024_institution_campaigns.sql') AS ready");
  return rows[0]?.ready===true;
 }catch{return false;}
}
