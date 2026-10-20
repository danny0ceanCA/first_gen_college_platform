import type {InstitutionPage} from './institutionContent.mjs';
export type OrganizationRegistration={action:'register';registrationKey:string;unitType:'institution';representative:{firstName:string;workEmail:string;jobRole:string};page:InstitutionPage};
export type SignupInstitutionResult={registeredInstitutionId?:string;institutions?:{id:string;status:string;revision:number;membershipRole:string;archivedAt?:string}[]};
export function signupOrganization(application:{displayName:string;email:string;jobRole:string;organizationName:string;organizationWebsite:string},description:string,registrationKey:string,authorized:boolean):OrganizationRegistration;
export function registerSignupOrganization(request:(input:unknown)=>Promise<SignupInstitutionResult>,registration:OrganizationRegistration):Promise<{id:string}>;
