// Only an explicit access decision may choose a workspace. An outage is unknown.
export async function adminAccessDecision(response){
 const data=await response.json();
 if(response.status===403&&data?.error==='admin_required')return 'denied';
 if(!response.ok||typeof data?.admin!=='boolean')throw new Error('account_access_unavailable');
 return data.admin?'allowed':'denied';
}
