// Bound expensive reviewer discovery reads before they acquire a DB connection.
// Per process, no queue, no actor identifiers, and no early release on disconnect:
// the slot belongs to the underlying operation until its promise settles.
export function createReviewAdmission(limit=2){
 if(!Number.isSafeInteger(limit)||limit<1||limit>4)throw Error('invalid_review_concurrency');
 let active=0;
 return {acquire(){
  if(active>=limit)return null;
  active++;let released=false;
  return ()=>{if(!released){released=true;active--;}};
 }};
}
export const isReviewDiscovery=action=>['applications','application-organizations'].includes(action);
