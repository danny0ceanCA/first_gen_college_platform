// SQLSTATE is deliberately finite: arbitrary five-character text is not safe.
const postgres=new Set('08000 08001 08003 08004 08006 08007 08P01 22000 22001 22003 22007 22P02 23000 23502 23503 23505 23514 25006 25P02 28000 28P01 40001 40P01 42501 42601 42703 42P01 53300 53400 55000 55P03 57014 57P01 57P02 57P03 58000 XX000'.split(' '));
export function safeErrorCode(error){
 const code=error?.code;
 if(postgres.has(code))return `postgres_${code}`;
 if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH'].includes(code))return code;
 if(error?.name==='TimeoutError')return 'timeout';
 if(error?.name==='AbortError')return 'aborted';
 return 'operation_failed';
}
export const technicalCodes=Object.freeze(['telemetry_configuration_invalid','telemetry_lifecycle_required','maintenance_database_required','restricted_maintenance_role_required','separate_maintenance_role_required','maintenance_migration_required','operation_failed','timeout','aborted','client_disconnected','queue_full','storage_unavailable','alert_query_failed','repeated_exports','repeated_access_denials','restricted_database_runtime_required','database_migration_required','configuration_invalid','startup_failed',...postgres].map(s=>postgres.has(s)?`postgres_${s}`:s).concat(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH']));
