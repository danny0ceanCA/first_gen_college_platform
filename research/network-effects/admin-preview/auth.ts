// Local preview only. This module is aliased by admin-preview.mjs, never the app build.
type Session={token:string;subject:string};
let session:Session|undefined;
export function configurePreviewAuth(value:Session){session=value;}
const getAccessTokenSilently=async()=>{if(!session)throw new Error('Preview session ended. Reload the page.');return session.token;};
const logout=async()=>{session=undefined;window.location.reload();};
const loginWithRedirect=async()=>{window.location.reload();};
const auth={getAccessTokenSilently,logout,loginWithRedirect,isAuthenticated:true,isLoading:false,user:{sub:'network-preview-admin'}};
export function useAuth0(){return auth;}
