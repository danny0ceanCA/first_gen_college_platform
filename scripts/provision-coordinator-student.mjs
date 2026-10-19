import {createDatabase} from '../server/database.mjs';
// Run with the migration credential after an operator verifies adult ownership.
// Exact subject/profile only; no email inference or student self-enrollment.
const {MIGRATION_DATABASE_URL,COORDINATOR_PILOT_SUBJECT:subject,COORDINATOR_PILOT_STUDENT:student,COORDINATOR_PILOT_REVIEWER:reviewer,COORDINATOR_PILOT_ACTION:action}=process.env;
if(!MIGRATION_DATABASE_URL||!subject||!student||!reviewer||!['approve','revoke'].includes(action))throw new Error('Migration credential, exact subject/student, reviewer and approve/revoke action required.');
const pool=createDatabase({DATABASE_URL:MIGRATION_DATABASE_URL}),c=await pool.connect();
try{
 await c.query('BEGIN');
 const a=(await c.query('SELECT id,role FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
 if(!a)throw new Error('Pilot account unavailable');
 if(action==='approve'){
  const eligible=(await c.query("SELECT e.revision FROM origen_eligibility e WHERE subject_hash=encode(sha256(convert_to($1,'UTF8')),'hex') AND status='adult' AND EXISTS(SELECT 1 FROM origen_students WHERE account_id=$2 AND id=$3) AND NOT EXISTS(SELECT 1 FROM origen_student_links WHERE (member_account_id=$2 AND member_student_id=$3) OR (owner_account_id=$2 AND owner_student_id=$3))",[subject,a.id,student])).rows[0];
  if(a.role!=='student'||!eligible)throw new Error('Adult-owned, unlinked student profile required');
  await c.query('INSERT INTO origen_coordinator_student_pilots(account_id,student_id,permission_revision,approved_by) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,student_id) DO UPDATE SET permission_revision=EXCLUDED.permission_revision,approved_by=EXCLUDED.approved_by,approved_at=now()',[a.id,student,eligible.revision,reviewer]);
 }else await c.query('DELETE FROM origen_coordinator_student_pilots WHERE account_id=$1 AND student_id=$2',[a.id,student]);
 await c.query('COMMIT');console.log('Coordinator student pilot change complete. No binder content published.');
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
