import {createDatabase} from '../server/database.mjs';
import {staffHash} from '../server/staff-access.mjs';
import {randomUUID} from 'node:crypto';
// Operator-only credential; never run from the web service environment.
const {MIGRATION_DATABASE_URL,STAFF_CONTROL_SUBJECT,STAFF_CONTROL_MODE,STAFF_CONTROL_OPERATOR}=process.env;
if(!MIGRATION_DATABASE_URL||!STAFF_CONTROL_SUBJECT?.trim()||STAFF_CONTROL_SUBJECT.length>255||!STAFF_CONTROL_OPERATOR?.trim()||!['block','unblock'].includes(STAFF_CONTROL_MODE))throw new Error('Set MIGRATION_DATABASE_URL, STAFF_CONTROL_SUBJECT, STAFF_CONTROL_OPERATOR and STAFF_CONTROL_MODE (block/unblock).');
const pool=createDatabase({DATABASE_URL:MIGRATION_DATABASE_URL}),c=await pool.connect();
try{
 await c.query('BEGIN');
 const hash=staffHash(STAFF_CONTROL_SUBJECT);
 await c.query('INSERT INTO origen_staff_access_controls(subject_hash,blocked) VALUES($1,$2) ON CONFLICT(subject_hash) DO UPDATE SET blocked=$2,token_valid_after=now(),updated_at=now()',[hash,STAFF_CONTROL_MODE==='block']);
 await c.query("INSERT INTO origen_privileged_access_audit(id,actor_hash,area,action,target_hash,outcome) VALUES($1,$2,'admin',$3,$4,'completed')",[randomUUID(),staffHash(STAFF_CONTROL_OPERATOR),`${STAFF_CONTROL_MODE}-staff`,hash]);
 await c.query('COMMIT');console.log('Staff control saved. Unblocking requires a newly issued token; roles and MFA are still required.');
}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
