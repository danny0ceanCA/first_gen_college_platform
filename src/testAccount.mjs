// UI conveniences for the owner's adult, synthetic-data test account only.
// This never grants backend access or overrides a recorded eligibility decision.
// Confirmed through Auth0 management: this disposable account uses a fictional
// mailbox, so email verification cannot identify it. Pin its authenticated ID.
export const ONBOARDING_TEST_SUBJECT='auth0|6ad14bb9afcad1dcde4964b9';
export function isOnboardingTestAccount(user){
 return !!user?.sub&&(user.email_verified===true||user.sub===ONBOARDING_TEST_SUBJECT)&&typeof user.email==='string'&&user.email.trim().toLowerCase()==='test@test.org';
}
export function shouldReplayTestOnboarding(user,loginId,completedLoginId){
 return isOnboardingTestAccount(user)&&loginId!==completedLoginId;
}
export function testAccountAdultScreen(user,status){
 return isOnboardingTestAccount(user)&&status==='unknown'?{action:'screen',ageBand:'18plus',audience:'adult_supporter'}:null;
}
export function testWorkspaceSeed(account,students,createId){
 return {firstName:account.firstName?.trim()||'Test',role:account.role||'student',
  student:students[0]||{id:createId(),name:'Test student',stage:'College',interest:'',gpa:'',color:'lilac'}};
}
