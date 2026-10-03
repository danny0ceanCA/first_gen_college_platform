export type AccountLink={id:string;studentId:string;studentName:string;personName:string;role:'parent'|'student';isOwner:boolean};
export type PendingInvite={id:string;studentId:string;studentName:string;role:'parent'|'student';expiresAt:string};
export type LinkResult={links:AccountLink[];invites:PendingInvite[];token?:string;studentId?:string;expiresAt?:string;invitation?:{studentName:string;inviterName:string;role:'parent'|'student';expiresAt:string}};
export async function linksRequest(getToken:()=>Promise<string|undefined>,base:string,operation:Record<string,unknown>,signal?:AbortSignal):Promise<LinkResult>{
 const token=await getToken();
 if(!token)throw new Error('authentication_required');
 const response=await fetch(`${base.replace(/\/$/,'')}/api/account-links`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(operation),signal});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'links_unavailable');
 return result;
}
export function inviteToken(value:string){
 const trimmed=value.trim();if(/^[A-Za-z0-9_-]{43}$/.test(trimmed))return trimmed;
 try{const url=new URL(trimmed);const token=url.hash.startsWith('#invite/')?url.hash.slice(8):url.protocol==='origen:'&&url.hostname==='invite'?url.searchParams.get('token')||'':'';return /^[A-Za-z0-9_-]{43}$/.test(token)?token:'';}catch{return '';}
}
export function inviteMessage(error:unknown,es=false){
 const code=error instanceof Error?error.message:'';
 const messages:Record<string,[string,string]>={
  invitation_unavailable:['This invitation expired, was used, or was cancelled. Ask for a new link.','La invitación venció, ya se usó o se canceló. Pide un enlace nuevo.'],
  cannot_accept_own_invitation:['Open this invitation with the other person’s account.','Abre esta invitación con la cuenta de la otra persona.'],
  already_linked:['Your account is already linked to this student.','Tu cuenta ya está vinculada a este estudiante.'],
  only_profile_owner_can_invite:['Ask the person who created this profile to send an invitation.','Pide a quien creó este perfil que envíe una invitación.'],
 };
 return (messages[code]||['Could not complete this request. Please try again.','No se pudo completar la solicitud. Intenta de nuevo.'])[es?1:0];
}
