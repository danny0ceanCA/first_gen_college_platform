import {createDatabase} from '../server/database.mjs';
// Read-only capability probe. Run separately with runtime and deployment role
// credentials in their normal secure bindings; never enables an extension.
const db=createDatabase(process.env);
if(!db)throw Error('database_required');
try{
 const extension=(await db.query("SELECT a.name,a.default_version,a.installed_version,v.trusted,v.superuser FROM pg_available_extensions a LEFT JOIN pg_available_extension_versions v ON v.name=a.name AND v.version=a.default_version WHERE a.name='vector'")).rows[0];
 const role=(await db.query("SELECT r.rolsuper AS superuser,has_database_privilege(current_database(),'CREATE') AS database_create FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
 const installed=(await db.query("SELECT has_schema_privilege(e.extnamespace,'USAGE') AS schema_usage,has_type_privilege(t.oid,'USAGE') AS type_usage FROM pg_extension e JOIN pg_type t ON t.typnamespace=e.extnamespace AND t.typname='vector' WHERE e.extname='vector'")).rows[0];
 const indexes=(await db.query("SELECT count(*)::int AS count FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('origen_history_search','origen_memory_search','origen_note_search') AND i.indisvalid")).rows[0].count;
 process.stdout.write(JSON.stringify({keywordIndexesReady:indexes===3,vectorAvailable:!!extension,vectorInstalled:!!extension?.installed_version,vectorTypeUsable:!!installed?.schema_usage&&!!installed?.type_usage,standardPostgresRoleCanEnable:!!extension&&(role.superuser||extension.trusted&&role.database_create||!extension.superuser&&role.database_create),vectorPathImplemented:false,method:'postgres-keyword-v1',note:'Provider-specific extension permissions require provider verification. No extension or database configuration was changed.'},null,2)+'\n');
}finally{await db.end();}
