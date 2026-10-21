import {createHash} from 'node:crypto';
// Called inside the institution transaction, after its account lock is held.
// The existing registration-request table is the durable application -> organization link.
export async function recoverSignupOrganization(c,subject,applicationId,{pending=false}={}){
 const fail=message=>Object.assign(new Error(message),{status:409});
 const application=(await c.query("SELECT origen_coordinator_application_command('{\"action\":\"application-status\"}'::jsonb) AS result")).rows[0]?.result?.application;
 if(!application||application.id!==applicationId||pending&&application.status!=='pending')throw fail('application_changed');
 const linked=(await c.query('SELECT institution_id FROM origen_institution_registration_requests WHERE auth0_subject=$1 AND request_id=$2',[subject,applicationId])).rows[0];
 let rows;
 if(linked){
  rows=(await c.query("SELECT i.*,m.role AS membership_role FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id WHERE i.id=$1 AND m.auth0_subject=$2 AND m.role='owner'",[linked.institution_id,subject])).rows;
  if(!rows.length)throw fail('organization_ownership_changed');
 }else{
  // Recover registrations made before application IDs were used as retry keys.
  // Never guess between multiple organizations or recover someone else's membership.
  rows=(await c.query("SELECT i.*,m.role AS membership_role FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id WHERE m.auth0_subject=$1 AND m.role='owner' AND i.parent_institution_id IS NULL AND i.draft->>'name'=$2 AND rtrim(i.draft->>'website','/')=rtrim($3,'/') ORDER BY i.created_at LIMIT 2",[subject,application.organizationName,application.organizationWebsite])).rows;
  if(rows.length>1)throw fail('organization_recovery_ambiguous');
  if(rows.length===1){
   // Persist legacy recovery before the owner can edit the name/website.
   await c.query('INSERT INTO origen_institution_registration_requests(auth0_subject,request_id,payload_hash,institution_id) VALUES($1,$2,$3,$4)',[subject,applicationId,createHash('sha256').update('recovered:'+rows[0].id).digest('hex'),rows[0].id]);
  }
 }
 return {application,organization:rows[0]||null};
}
