import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../server/database.mjs';
import { sqlIdentifier } from '../server/account-isolation.mjs';

// Apply only this additive release migration. Historical checksum discrepancies
// elsewhere are not silently repaired or bypassed by a full migration run.
export async function migrateDecisions(pool, runtimeRole) {
  const role=sqlIdentifier(runtimeRole),name='125_decisions_events.sql';
  const sql=(await readFile(new URL('../server/migrations/'+name,import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const checksum=createHash('sha256').update(sql).digest('hex');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(728419,1)');
    const previous=(await client.query('SELECT checksum FROM origen_schema_migrations WHERE name=$1',['124_voice_research_traces.sql'])).rows[0];
    const previousSql=(await readFile(new URL('../server/migrations/124_voice_research_traces.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
    if(previous?.checksum!==createHash('sha256').update(previousSql).digest('hex'))throw Error('research_trace_baseline_required');
    const info=(await client.query(`SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1`,[runtimeRole])).rows[0];
    if(!info?.rolcanlogin||info.rolsuper||info.rolbypassrls||info.rolcreaterole||info.rolcreatedb)throw Error('restricted_runtime_role_required');
    const existing=(await client.query('SELECT checksum FROM origen_schema_migrations WHERE name=$1',[name])).rows[0];
    if(existing&&existing.checksum!==checksum)throw Error('decisions_migration_checksum_conflict');
    if(!existing){await client.query(sql);await client.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);}
    await client.query(`REVOKE ALL ON origen_decisions_events FROM PUBLIC,${role}`);
    await client.query(`GRANT SELECT,INSERT ON origen_decisions_events TO ${role}`);
    await client.query('COMMIT');return {migration:name,checksum,applied:!existing,runtimeRole};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_RUNTIME_ROLE)throw Error('migration_url_and_runtime_role_required');
  const pool=createDatabase({...process.env,DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
  try{console.log(JSON.stringify(await migrateDecisions(pool,process.env.DATABASE_RUNTIME_ROLE)));}
  finally{await pool.end();}
}
