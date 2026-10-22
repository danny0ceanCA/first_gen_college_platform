export const correctionsEnabled=env=>env.ORIGEN_BINDER_CORRECTIONS==='true';
export async function assertCorrectionsReady(database,env){
 if(!correctionsEnabled(env))return;
 if(!database||!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='063_binder_corrections.sql'")).rows.length)throw new Error('binder_corrections_migration_required');
}
