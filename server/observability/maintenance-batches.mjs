import {maintenanceDeleteTables} from '../maintenance-database.mjs';
// Only the reviewed maintenance runner uses this adapter. No SQL or parameters
// enter telemetry. Bound each mutation while preserving its existing predicate
// and triggers, so large sweeps make incremental progress on later ticks.
export function maintenanceBatch(sql){
 if(typeof sql!=='string')return sql;
 const deletion=/^DELETE FROM (origen_[a-z_]+) WHERE ([\s\S]+)$/i.exec(sql);
 if(deletion&&maintenanceDeleteTables.includes(deletion[1]))return `DELETE FROM ${deletion[1]} WHERE ctid IN (SELECT ctid FROM ${deletion[1]} WHERE ${deletion[2]} LIMIT 250)`;
 const update=/^UPDATE (origen_[a-z_]+) SET ([\s\S]+?) WHERE ([\s\S]+)$/i.exec(sql);
 if(update&&['origen_eligibility','origen_guidance_sessions','origen_ai_executions'].includes(update[1]))return `UPDATE ${update[1]} SET ${update[2]} WHERE ctid IN (SELECT ctid FROM ${update[1]} WHERE ${update[3]} LIMIT 250)`;
 return sql;
}
