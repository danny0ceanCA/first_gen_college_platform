import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const REQUIRED_GATES = ['hosting','provider-retention','restore','deletion-replay','admin-access','accessibility','security','incident-ownership','pilot-commitments'];
// A local evidence validator, not an authorization or compliance decision.
export function assessReadiness(register, now = new Date()) {
 const reasons=[];
 if(register?.schemaVersion!==1)reasons.push('Unsupported evidence register');
 for(const id of REQUIRED_GATES){
  const rows=register?.gates?.filter(row=>row.id===id)||[];
  if(rows.length!==1){reasons.push(`${id}: missing or duplicate gate`);continue;}
  const row=rows[0];
  if(row.status!=='verified')reasons.push(`${id}: ${row.status||'missing status'}`);
  if(!row.owner?.trim())reasons.push(`${id}: accountable owner missing`);
  if(!row.evidence?.length||row.evidence.some(item=>typeof item!=='string'||!item.trim()))reasons.push(`${id}: evidence missing`);
  const checked=Date.parse(row.checkedAt),expires=Date.parse(row.expiresAt);
  if(!Number.isFinite(checked)||checked>now.getTime()||!Number.isFinite(expires)||expires<=now.getTime()||expires<=checked)reasons.push(`${id}: invalid, future or expired evidence dates`);
  if(!row.approvedBy?.trim())reasons.push(`${id}: review approval missing`);
 }
 return {schemaVersion:1,assessedAt:now.toISOString(),ready:reasons.length===0,blockingReasons:reasons};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const register=JSON.parse(await readFile(new URL('./evidence.json',import.meta.url),'utf8'));
 const result=assessReadiness(register);
 await writeFile(new URL('./latest-readiness.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 if(!result.ready)process.exitCode=2;
}
