import {isOnboardingTestAccount} from './testAccount.mjs';

// Called only by explicit logout, never by reload, route changes or unmount.
export async function resetTestSession({user,getToken,stop,fetcher=fetch,base=''}){
 if(!isOnboardingTestAccount(user))return;
 const token=await getToken();
 if(!token)throw new Error('authentication_required');
 stop();
 const response=await fetcher(`${base}/api/account-data`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'reset-test-session'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok||(await response.json()).reset!==true)throw new Error('test_session_reset_failed');
}
