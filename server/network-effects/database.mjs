import { createDatabase } from '../database.mjs';

export function networkDatabase(env = process.env, { migration = false } = {}) {
  const connection = migration ? env.NETWORK_EFFECTS_MIGRATION_DATABASE_URL : env.NETWORK_EFFECTS_DATABASE_URL;
  if (!connection?.trim()) throw new Error('network_database_not_configured');
  // Deliberately no fallback to DATABASE_URL or automatic .env loading.
  return createDatabase({ ...env, DATABASE_URL: connection, DATABASE_TLS_MODE: env.NETWORK_EFFECTS_DATABASE_TLS_MODE,
    DATABASE_SSL_CA: env.NETWORK_EFFECTS_DATABASE_SSL_CA }, undefined, { max: 2 });
}

export async function assertNetworkRole(pool, role = 'origen_network_worker') {
  const row = (await pool.query(`SELECT current_user AS name,
    EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AND pg_has_role(current_user,r.oid,'MEMBER')) AS powerful,
    has_schema_privilege(current_user,'origen_network_effects','CREATE') AS can_create,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('origen_network_effects','pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
      AND c.relkind IN ('r','p','v','f') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) AS other_writes,
    has_table_privilege(current_user,'origen_network_effects.sources','INSERT,UPDATE,DELETE,TRUNCATE') AS source_writes`)).rows[0];
  if (row?.name !== role || row.powerful || row.can_create || row.other_writes || role === 'origen_network_admin' && row.source_writes)
    throw Object.assign(new Error('restricted_network_role_required'), { status: 503 });
}
