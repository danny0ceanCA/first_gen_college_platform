import type {StudentProfile} from './planning';
type TestIdentity={sub?:string;email?:string;email_verified?:boolean}|undefined;
export const ONBOARDING_TEST_SUBJECT:string;
export function isOnboardingTestAccount(user:TestIdentity):boolean;
export function shouldReplayTestOnboarding(user:TestIdentity,loginId:string,completedLoginId:string|null):boolean;
export function testAccountAdultScreen(user:TestIdentity,status:string):{action:'screen';ageBand:'18plus';audience:'adult_supporter'}|null;
export function testWorkspaceSeed(account:{firstName?:string;role?:'parent'|'student'},students:StudentProfile[],createId:()=>string):{firstName:string;role:'parent'|'student';student:StudentProfile};
