import type {InstitutionPage} from './institutionContent.mjs';
export type OrganizationRegistration={action:'register';registrationKey:string;applicationId?:string;unitType:'institution';representative:{firstName:string;workEmail:string;jobRole:string};page:InstitutionPage};
export type SignupOrganization={id:string;status:string;revision:number;membershipRole:string;archivedAt?:string;page:InstitutionPage;reviews?:{action:string;note:string;revision:number}[]};
export type SignupInstitutionResult={registeredInstitutionId?:string;institutions?:{id:string;status:string;revision:number;membershipRole:string;archivedAt?:string}[]};
export function signupOrganization(application:{id?:string;displayName:string;email:string;jobRole:string;organizationName:string;organizationWebsite:string},description:string,registrationKey:string,authorized:boolean):OrganizationRegistration;
export function registerSignupOrganization(request:(input:unknown)=>Promise<SignupInstitutionResult>,registration:OrganizationRegistration):Promise<{id:string}>;
export function signupMatchesApplication(signup:unknown,application:unknown):boolean;
