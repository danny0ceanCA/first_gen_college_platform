import {notifyInstitution} from './institution-notifications.mjs';
import {createHash,randomBytes} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const accessActions=['access','parents','team','invite','accept-invite','revoke-invite','remove-member','set-role','transfer-owner','approve-unit','reject-unit','request-affiliation','review-affiliation'];
const uuid=v=>{if(typeof v!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw fail(400,'invalid_institution');return v;};
const subject=v=>{if(typeof v!=='string'||!v.trim()||v.length>255)throw fail(400,'invalid_institution');return v;};
export function validateAccess(input){
 const action=input.action,out={action};
 if(action==='access')return out;
 if(action==='parents'){if(input.search!==undefined&&(typeof input.search!=='string'||input.search.length>200))throw fail(400,'invalid_institution');return {...out,search:(input.search||'').trim()};}
 if(action==='accept-invite'){if(typeof input.token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(input.token))throw fail(400,'invalid_institution');return {...out,token:input.token};}
 if(action==='request-affiliation'){
  out.requestId=uuid(input.requestId);out.parentId=input.parentId?uuid(input.parentId):null;
  for(const key of ['parentName','parentWebsite','unitName','firstName','workEmail','jobRole']){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>(key==='parentWebsite'?2000:key==='workEmail'?320:key==='firstName'?100:200))throw fail(400,'invalid_institution');out[key]=input[key].trim();}
  let url;try{url=new URL(out.parentWebsite);}catch{throw fail(400,'invalid_institution');}if(url.protocol!=='https:'||url.username||url.password)throw fail(400,'invalid_institution');out.parentWebsite=url.href;
  if(! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.workEmail)||!['institution','department','program'].includes(input.unitType))throw fail(400,'invalid_institution');out.unitType=input.unitType;return out;
 }
 out.id=uuid(input.id);
 if(action==='review-affiliation'){if(!['verified','changes-requested','resolved'].includes(input.status)||typeof input.note!=='string'||!input.note.trim()||input.note.length>2000)throw fail(400,'invalid_institution');return {...out,status:input.status,note:input.note.trim(),parentId:input.parentId?uuid(input.parentId):null};}
 if(action==='invite'){if(typeof input.email!=='string'||input.email.length>320||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw fail(400,'invalid_institution');out.email=input.email.trim().toLowerCase();}
 if(['invite','set-role'].includes(action)){if(!['editor','outreach','analyst'].includes(input.role))throw fail(400,'invalid_institution');out.role=input.role;}
 if(['remove-member','set-role','transfer-owner'].includes(action))out.subject=subject(input.subject);
 if(action==='revoke-invite')out.inviteId=uuid(input.inviteId);
 if(['approve-unit','reject-unit'].includes(action))out.unitId=uuid(input.unitId);
 return out;
}
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
export async function membership(c,id,sub){return (await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[id,sub])).rows[0];}
export async function accessEvent(c,id,sub,action,target=null){await c.query('INSERT INTO origen_institution_access_events(institution_id,actor_subject,action,target_subject) VALUES($1,$2,$3,$4)',[id,sub,action,target]);}
export async function runAccess(c,sub,input,identity={},canReview=false){
 const action=input.action;
 if(action==='access'){
  const memberships=(await c.query('SELECT i.id,i.draft,i.parent_institution_id,m.role FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id WHERE m.auth0_subject=$1 ORDER BY i.created_at',[sub])).rows;
  const personal=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[sub])).rows.length>0;
  return {memberships:memberships.map(r=>({id:r.id,name:r.draft.name,role:r.role,parentInstitutionId:r.parent_institution_id})),hasPersonalAccount:personal};
 }
 if(action==='parents'){
  // Only published parent names or the requester's own parents are searchable.
  const rows=(await c.query("SELECT i.id,i.draft,i.published,i.slug FROM origen_institutions i WHERE i.parent_institution_id IS NULL AND i.archived_at IS NULL AND (i.published IS NOT NULL OR i.id IN (SELECT institution_id FROM origen_institution_members WHERE auth0_subject=$1)) ORDER BY i.created_at DESC",[sub])).rows;
  return {parents:rows.filter(r=>(r.published?.name||r.draft.name).toLowerCase().includes(input.search.toLowerCase())).slice(0,25).map(r=>({id:r.id,name:(r.published||r.draft).name,website:(r.published||r.draft).website}))};
 }
 if(action==='request-affiliation'){
  if(input.parentId){const parent=(await c.query('SELECT id FROM origen_institutions WHERE id=$1 AND parent_institution_id IS NULL AND published IS NOT NULL AND archived_at IS NULL',[input.parentId])).rows[0];if(!parent)throw fail(404,'parent_not_found');}
  await c.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$2,$3,$4) ON CONFLICT(auth0_subject) DO NOTHING',[sub,input.firstName,input.workEmail,input.jobRole]);
  const existing=(await c.query('SELECT * FROM origen_institution_affiliation_requests WHERE auth0_subject=$1 AND request_id=$2',[sub,input.requestId])).rows[0];
  if(existing){if(existing.parent_name!==input.parentName||existing.parent_website!==input.parentWebsite||existing.unit_name!==input.unitName||existing.unit_type!==input.unitType||existing.parent_institution_id!==input.parentId)throw fail(409,'registration_changed');return {requested:true};}
  await c.query('INSERT INTO origen_institution_affiliation_requests(auth0_subject,request_id,parent_institution_id,parent_name,parent_website,unit_name,unit_type) VALUES($1,$2,$3,$4,$5,$6,$7)',[sub,input.requestId,input.parentId,input.parentName,input.parentWebsite,input.unitName,input.unitType]);
  return {requested:true};
 }
 if(action==='review-affiliation'){
  if(!canReview)throw fail(403,'reviewer_required');
  const req=(await c.query('SELECT * FROM origen_institution_affiliation_requests WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
  if(!req)throw fail(404,'request_not_found');
  const parentId=input.parentId||req.parent_institution_id;
  if(parentId){const parent=(await c.query('SELECT id FROM origen_institutions WHERE id=$1 AND parent_institution_id IS NULL AND published IS NOT NULL AND archived_at IS NULL',[parentId])).rows[0];if(!parent)throw fail(404,'parent_not_found');}
  if(req.auth0_subject===sub||parentId&&await membership(c,parentId,sub))throw fail(403,'independent_review_required');
  // Review alone never grants access. Owners invite staff after verification.
  if(input.status==='resolved'&&(!parentId||!await membership(c,parentId,req.auth0_subject)))throw fail(409,'membership_required');
  await c.query('UPDATE origen_institution_affiliation_requests SET status=$2,review_note=$3,reviewer_subject=$4,parent_institution_id=$5,updated_at=now() WHERE id=$1',[input.id,input.status,input.note,sub,parentId]);return {ok:true};
 }
 if(action==='accept-invite'){
  const found=(await c.query('SELECT institution_id FROM origen_institution_invites WHERE token_hash=$1',[hashToken(input.token)])).rows[0];
  if(!found)throw fail(410,'invitation_unavailable');
  // Same lock order as ownership transfer and revocation, so an invitation
  // cannot slip through after its creator loses owner access.
  await c.query('SELECT id FROM origen_institutions WHERE id=$1 FOR UPDATE',[found.institution_id]);
  const inv=(await c.query('SELECT * FROM origen_institution_invites WHERE token_hash=$1 FOR UPDATE',[hashToken(input.token)])).rows[0];
  if(!inv||inv.revoked_at||inv.accepted_at||new Date(inv.expires_at).getTime()<=Date.now())throw fail(410,'invitation_unavailable');
  if(identity.sub!==sub||identity.email_verified!==true||typeof identity.email!=='string'||identity.email.toLowerCase()!==inv.recipient_email)throw fail(403,'invitation_email_required');
  if((await membership(c,inv.institution_id,inv.created_by))?.role!=='owner')throw fail(410,'invitation_unavailable');
  if(await membership(c,inv.institution_id,sub))throw fail(409,'already_a_member');
  const name=typeof identity.given_name==='string'&&identity.given_name.trim()?identity.given_name.trim().slice(0,100):'Representative';
  await c.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$2,$3,$4) ON CONFLICT(auth0_subject) DO NOTHING',[sub,name,identity.email,'Invited staff']);
  await c.query('INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,$2,$3)',[inv.institution_id,sub,inv.role]);
  await c.query('UPDATE origen_institution_invites SET accepted_by=$2,accepted_at=now() WHERE id=$1',[inv.id,sub]);
  await accessEvent(c,inv.institution_id,sub,'accept-invite',sub);return {accepted:true,institutionId:inv.institution_id};
 }
 // Serialize team and ownership mutations against edits and approval changes.
 const institution=(await c.query('SELECT * FROM origen_institutions WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
 if(!institution||!(await membership(c,input.id,sub)))throw fail(404,'institution_not_found');
 const member=await membership(c,input.id,sub);
 if(member.role!=='owner')throw fail(403,'owner_required');
 if(action==='team'){
  const members=(await c.query('SELECT m.auth0_subject,m.role,r.first_name,r.work_email FROM origen_institution_members m JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject WHERE m.institution_id=$1',[input.id])).rows;
  const invites=(await c.query('SELECT id,recipient_email,role,expires_at,accepted_at,revoked_at FROM origen_institution_invites WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 50',[input.id])).rows;
  const history=(await c.query('SELECT action,actor_subject,target_subject,created_at FROM origen_institution_access_events WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 30',[input.id])).rows;
  return {members,invites,history};
 }
 if(action==='invite'){
  const token=randomBytes(32).toString('base64url');
  const row=(await c.query('INSERT INTO origen_institution_invites(institution_id,token_hash,recipient_email,role,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[input.id,hashToken(token),input.email,input.role,sub,new Date(Date.now()+7*86400000)])).rows[0];
  await accessEvent(c,input.id,sub,'invite');return {inviteId:row.id,token};
 }
 if(action==='revoke-invite'){
  await c.query('UPDATE origen_institution_invites SET revoked_at=now() WHERE id=$1 AND institution_id=$2 AND accepted_at IS NULL',[input.inviteId,input.id]);
  await accessEvent(c,input.id,sub,action);return {ok:true};
 }
 if(['approve-unit','reject-unit'].includes(action)){
  const unit=(await c.query('SELECT * FROM origen_institutions WHERE id=$1 FOR UPDATE',[input.unitId])).rows[0];
  if(!unit||unit.parent_institution_id!==input.id)throw fail(404,'institution_not_found');
  if(institution.archived_at||unit.archived_at)throw fail(409,'institution_archived');
  if(unit.parent_approval!=='pending')throw fail(409,'unit_request_resolved');
  await c.query('UPDATE origen_institutions SET parent_approval=$2,revision=revision+1,updated_at=now() WHERE id=$1',[unit.id,action==='approve-unit'?'approved':'rejected']);
  await notifyInstitution(c,unit.id,action==='approve-unit'?'parent-approved':'parent-rejected',unit.revision+1);
  await accessEvent(c,input.id,sub,action);return {ok:true};
 }
 const target=await membership(c,input.id,input.subject);
 if(!target)throw fail(404,'member_not_found');
 if(action==='transfer-owner'){
  if(input.subject===sub)throw fail(400,'invalid_institution');
  await c.query("UPDATE origen_institution_members SET role='owner' WHERE institution_id=$1 AND auth0_subject=$2",[input.id,input.subject]);
  await c.query("UPDATE origen_institution_members SET role='editor' WHERE institution_id=$1 AND auth0_subject=$2",[input.id,sub]);
 }else{
  if(target.role==='owner')throw fail(409,'transfer_ownership_first');
  if(action==='remove-member')await c.query('DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[input.id,input.subject]);
  else await c.query('UPDATE origen_institution_members SET role=$3 WHERE institution_id=$1 AND auth0_subject=$2',[input.id,input.subject,input.role]);
 }
 if(action==='remove-member'||action==='transfer-owner')await c.query('UPDATE origen_institution_invites SET revoked_at=now() WHERE institution_id=$1 AND created_by=$2 AND accepted_at IS NULL',[input.id,input.subject===sub?sub:action==='transfer-owner'?sub:input.subject]);
 await accessEvent(c,input.id,sub,action,input.subject);return {ok:true};
}

// Fetch trusted identity attributes with the already verified bearer token. The
// browser's profile and representative form are never proof of email ownership.
export async function invitationIdentity(req,env,fetcher=fetch){
 const domain=env.AUTH0_DOMAIN;
 if(!domain||! /^[a-z0-9.-]+$/i.test(domain))throw fail(503,'identity_verification_unavailable');
 let response;try{response=await fetcher(`https://${domain}/userinfo`,{headers:{Authorization:req.headers.authorization},signal:AbortSignal.timeout(8000)});}catch{throw fail(503,'identity_verification_unavailable');}
 if(!response.ok)throw fail(403,'invitation_email_required');
 const identity=await response.json();
 if(identity.sub!==req.origenIdentity.sub)throw fail(403,'invitation_email_required');
 return identity;
}
