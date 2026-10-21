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
