// Bound review operations before they acquire a DB connection.
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
export const isReviewDiscovery=action=>['applications','application-organizations','organization-queue'].includes(action);

// Both approval APIs use the same database pool. Writes waiting on review
// locks need the same bound as reads; independent per-route limits add up.
// Keep suspension and other access-removal operations outside this gate.
const gates=new WeakMap();
export function reviewAdmissionFor(database){
 if(!database)return createReviewAdmission();
 if(!gates.has(database))gates.set(database,createReviewAdmission());
 return gates.get(database);
}
export const isReviewWork=action=>isReviewDiscovery(action)||['queue','verify','publish','request-changes','review-affiliation','approve-organization','approve-application','decline-application'].includes(action);
