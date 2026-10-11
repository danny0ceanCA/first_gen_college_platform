import {createHash,randomUUID} from 'node:crypto';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';

export const MFA_TIME_CLAIM='https://origenedu.ai/mfa_time';
export const ADMIN_ACTIONS=Object.freeze({
 overview:'read:activity',engagement:'read:users','progress-report':'read:activity',
 users:'read:users','user-detail':'read:users','user-history':'read:users','user-conversations':'read:users',
 'onboarding-timeline':'read:users','onboarding-attempt':'read:users','onboarding-metrics':'read:activity','onboarding-alerts':'read:activity',
 'voice-quality':'read:quality','conversation-quality':'read:quality','review-queue':'read:quality','review-history':'read:quality','review-evidence':'read:quality',
 'conversation-review':'write:reviews','review-decision':'write:reviews',
 'institution-report':'read:institutions','institution-snapshots':'read:institutions','institution-snapshot':'read:institutions','institution-snapshot-save':'write:reports',
});
export const staffHash=value=>createHash('sha256').update(value).digest('hex');
export function staffPermissions(identity,env={}){
 const known=new Set([...Object.values(ADMIN_ACTIONS),'manage:institutions']);
 const permissions=new Set((Array.isArray(identity?.permissions)?identity.permissions:[]).filter(p=>known.has(p)));
 // Legacy allowlists retain reporting only. They cannot grant new write powers.
 if((env.ADMIN_SUBJECTS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(identity?.sub))permissions.add('read:activity');
 if((env.INSTITUTION_REVIEWER_SUBJECTS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(identity?.sub))permissions.add('manage:institutions');
 return [...permissions];
}
export function staffAuthenticationError(identity,{fresh=false,now=Date.now()}={}){
 const seconds=Math.floor(now/1000),maximum=fresh?300:43200;
 const valid=time=>Number.isSafeInteger(time)&&time>0&&time<=seconds&&seconds-time<=maximum;
 if(!valid(identity?.[MFA_TIME_CLAIM]))return 'staff_mfa_required';
 if(!valid(identity?.[AUTH_TIME_CLAIM]))return 'reauthentication_required';
 return null;
}
export function adminCapabilities(identity,env){
 const permissions=staffPermissions(identity,env);
 return {admin:Object.values(ADMIN_ACTIONS).some(p=>permissions.includes(p)),permissions,
  actions:Object.entries(ADMIN_ACTIONS).filter(([,p])=>permissions.includes(p)).map(([a])=>a),
  authenticationRequired:staffAuthenticationError(identity)};
}

// No arbitrary payloads, names, email addresses, notes, tokens, or conversation
// contents can enter this log. "authorized" records a gate decision, not success.
export async function auditStaffDecision(database,identity,{scope,action,target,outcome}){
 if(!['admin','institution','inquiry','campaign','metrics','family'].includes(scope)||!/^[a-z][a-z-]{0,40}$/.test(action)||!['authorized','denied','completed'].includes(outcome))throw new Error('invalid_audit_event');
 await database.query('INSERT INTO origen_privileged_access_audit(id,actor_hash,area,action,target_hash,outcome) VALUES($1,$2,$3,$4,$5,$6)',
  [randomUUID(),staffHash(identity.sub),scope,action,typeof target==='string'&&target?staffHash(target):null,outcome]);
}
export async function requireStaffAccess(database,identity,{scope,action,target,permission,env={},fresh=false}){
 let error=permission&&!staffPermissions(identity,env).includes(permission)?'staff_permission_required':staffAuthenticationError(identity,{fresh});
 if(!error){
  const control=(await database.query('SELECT blocked,token_valid_after FROM origen_staff_access_controls WHERE subject_hash=$1',[staffHash(identity.sub)])).rows[0];
  if(control&&(control.blocked||!Number.isSafeInteger(identity.iat)||identity.iat*1000<=new Date(control.token_valid_after).getTime()))error='staff_access_revoked';
 }
 // Audit availability is mandatory before any protected read or mutation.
 try{await auditStaffDecision(database,identity,{scope,action,target,outcome:error?'denied':'authorized'});}
 catch{throw Object.assign(new Error('staff_audit_unavailable'),{status:503});}
 if(error)throw Object.assign(new Error(error),{status:403});
}
