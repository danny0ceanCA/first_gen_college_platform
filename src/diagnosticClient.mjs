import {browserPrivacy} from './browserPrivacy.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function createDiagnosticHints(privacy,random=()=>crypto.randomUUID(),clock=Date.now){
 const hints=new Map();
 privacy.subscribe(event=>{
  if(event.type==='end')hints.clear();
  else for(const [key,item] of hints)if(event.target?.studentId===item.studentId||event.target?.id===item.logicalId)hints.delete(key);
 });
 return (kind,studentId,logicalId)=>{
  if(!privacy.valid())return random();
  const key=JSON.stringify([privacy.subject,kind,studentId,logicalId]);
  const previous=hints.get(key);if(previous&&clock()-previous.created<86400000)return previous.hint;
  if(hints.size>=1000)hints.delete(hints.keys().next().value);
  const hint=random();hints.set(key,{hint,studentId,logicalId,created:clock()});return hint;
 };
}
export const diagnosticHint=createDiagnosticHints(browserPrivacy);
export function responseReference(response){const id=response.headers.get('X-Request-ID');return uuid(id)?id:undefined;}
export function apiFailure(response,message){return Object.assign(new Error(message),{status:response.status,errorReference:responseReference(response)});}
