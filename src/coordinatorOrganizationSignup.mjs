// Reuse institution registration and its idempotency key. Signup never approves
// an organization, a coordinator, or a student share.
export function signupOrganization(application,description,registrationKey,authorized){
 if(!authorized||!description.trim())throw new Error('organization_details_required');
 return {action:'register',registrationKey,...(application.id?{applicationId:application.id}:{}),unitType:'institution',
  representative:{firstName:application.displayName,workEmail:application.email,jobRole:application.jobRole},
  page:{name:application.organizationName,website:application.organizationWebsite,description:description.trim(),programs:'',admissions:'',financialAid:'',events:'',publicEmail:'',links:[]}};
}

export async function registerSignupOrganization(request,registration){
 // Retrying the exact registration is safe even if its first response was lost.
 const registered=await request(registration);
 const organization=registered.institutions?.find(item=>item.id===registered.registeredInstitutionId);
 if(!organization||organization.membershipRole!=='owner'||organization.archivedAt||!['draft','submitted','published','changes-requested'].includes(organization.status))throw new Error('organization_registration_incomplete');
 if(organization.status==='draft'){
  const submitted=await request({action:'submit',id:organization.id,revision:organization.revision});
  const current=submitted.institutions?.find(item=>item.id===organization.id);
  if(current?.status!=='submitted')throw new Error('organization_registration_incomplete');
 }
 return {id:organization.id};
}

export function signupMatchesApplication(signup,application){
 const r=signup?.registration;
 return !!(r&&application&&r.applicationId===application.id&&r.page.name===application.organizationName&&r.page.website===application.organizationWebsite&&r.representative.firstName===application.displayName&&r.representative.workEmail===application.email&&r.representative.jobRole===application.jobRole);
}

export function savedOrganizationSignup(application){
 const saved=application?.organizationRegistration;
 if(!saved||saved.authorized!==true||typeof saved.description!=='string'||!saved.description.trim())return null;
 return {registration:signupOrganization(application,saved.description,application.id,true)};
}

// Called after each authenticated return, including a new tab with no draft storage.
// The server rechecks MFA/ownership on every operation; no approval is granted here.
export async function resumeOrganizationSignup(request,application){
 const status={action:'signup-status',applicationId:application.id};
 const result=await request(status);
 const signup=savedOrganizationSignup(application);
 if(application.status==='pending'&&signup&&(!result.organization||result.organization.status==='draft')){
  await registerSignupOrganization(request,signup.registration);
  return (await request(status)).organization;
 }
 return result.organization;
}
