export type Journey='registered'|'onboarding_started'|'save_unconfirmed'|'profile_saved'|'guidance_used';
export type AdminUser={id:string;first_name:string;role:string|null;created_at:string;profile_complete:boolean;profile_details_present?:boolean;student_profiles?:string|number;journey_stage?:Journey;admin_access?:'confirmed'|'not_verified';first_guidance_at?:string|null;last_activity_at?:string|null;last_activity_kind?:string;onboarding_started_at:string|null;onboarding_completed_at:string|null;logins:string;last_login:string|null;voice_minutes:string;calls?:string};
export const date=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'Not recorded';
export const number=(value:unknown)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1});
export const journeys:Record<Journey,{label:string;note:string}>={
 registered:{label:'Registered',note:'No setup milestone recorded'},
 onboarding_started:{label:'Onboarding started',note:'No confirmed profile save'},
 save_unconfirmed:{label:'Save unconfirmed',note:'Details exist; completion history is missing'},
 profile_saved:{label:'Profile saved',note:'Server-confirmed setup completion'},
 guidance_used:{label:'Used guidance after setup',note:'Connected non-onboarding call after saving'}
};
export const activityLabels:Record<string,string>={registered:'Account registered',sign_in:'Signed in',voice_activity:'Voice activity / heartbeat',onboarding_receipt:'Onboarding event received',onboarding_started:'Onboarding opened',profile_saved:'Profile saved'};
export const roleLabel=(role:string|null)=>role==='parent'?'Parent / guardian':role==='student'?'Student':'Not provided';
export function JourneyStatus({user}:{user:AdminUser}){const stage=user.journey_stage&&journeys[user.journey_stage];return <div className="admin-journey-status"><span className={`admin-journey-badge ${stage?user.journey_stage:'unknown'}`}>{stage?.label||'Journey not recorded'}</span><small>{stage?.note||'Refresh after the reporting update is deployed'}</small>{user.admin_access==='confirmed'&&!user.onboarding_completed_at&&<small>Setup is optional for admins.</small>}</div>;}
