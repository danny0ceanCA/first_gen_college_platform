import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { migrateDatabase } from '../../../server/database.mjs';
import { grantRuntimeAccess } from '../../../server/runtime-grants.mjs';
import { LOCAL_COPY } from './launch.mjs';

// No environment loading or remote connection string is accepted. Preserve the
// existing copied database; upgrade a separate clone for this local experiment.
const source = 'origen_research_local_20261104';
const marker = 'origen-decisions-local-observer-copy-20261107';
const url = name => `postgresql://postgres@127.0.0.1:55480/${name}`;
async function localOwner(pool, name) {
  const row = (await pool.query('SELECT current_database() AS name,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
  if (row?.name !== name || row.role !== 'postgres' || row.host !== '127.0.0.1' || row.port !== 55480) throw Error('local_owner_identity_required');
}
const admin = new pg.Pool({ connectionString: url('postgres'), max: 1, connectionTimeoutMillis: 5000 });
try {
  await localOwner(admin, 'postgres');
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [source])).rowCount) throw Error('existing_local_copy_required');
  const exists = (await admin.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [LOCAL_COPY.database])).rows[0];
  if (exists && exists.marker !== marker) throw Error('unexpected_existing_local_database');
  if (!exists) {
    // Identifiers are hardcoded above, never from requests or environment data.
    await admin.query(`CREATE DATABASE ${LOCAL_COPY.database} WITH TEMPLATE ${source}`);
    await admin.query(`COMMENT ON DATABASE ${LOCAL_COPY.database} IS '${marker}'`);
  }
} finally { await admin.end(); }

const pool = new pg.Pool({ connectionString: url(LOCAL_COPY.database), max: 1, connectionTimeoutMillis: 5000 });
try {
  await localOwner(pool, LOCAL_COPY.database);
  await migrateDatabase(pool);
  await grantRuntimeAccess(pool, LOCAL_COPY.runtimeRole);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = (await client.query("SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='origen_research_worker'")).rows[0];
    if (!role?.rolcanlogin || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb) throw Error('restricted_worker_login_required');
    if ((await client.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='origen_research_worker')")).rowCount
      || (await client.query("SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='origen_research_worker')")).rowCount) throw Error('worker_must_not_inherit_roles_or_own_tables');
    await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM origen_research_worker');
    await client.query('REVOKE CREATE ON SCHEMA public FROM origen_research_worker');
    await client.query('GRANT USAGE ON SCHEMA public TO origen_research_worker');
    await client.query('GRANT EXECUTE ON FUNCTION origen_current_account_id() TO origen_research_worker');
    await client.query('GRANT SELECT,UPDATE,DELETE ON origen_voice_research_jobs TO origen_research_worker');
    await client.query('GRANT SELECT,INSERT,UPDATE ON origen_voice_research_traces TO origen_research_worker');
    await client.query('GRANT SELECT,INSERT ON origen_voice_research_trace_events TO origen_research_worker');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  const migration = (await pool.query('SELECT name FROM origen_schema_migrations ORDER BY name DESC LIMIT 1')).rows[0]?.name;
  const students = Number((await pool.query('SELECT count(*) FROM origen_students')).rows[0]?.count);
  const report = { preparedAt: new Date().toISOString(), localOnly: true, dataKind: 'isolated-copy', sourceDatabase: source,
    database: LOCAL_COPY.database, host: '127.0.0.1', port: 55480, latestMigration: migration, studentCount: students,
    sourcePreserved: true, productionAccess: false };
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.local/local-app-setup.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await pool.end(); }
