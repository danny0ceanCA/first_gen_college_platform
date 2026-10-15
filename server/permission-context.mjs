import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
export const permissionContext=new AsyncLocalStorage();
export const permissionError=()=>Object.assign(new Error('permission_required'),{status:403});
export const eligibilityAllowed=(row,now=Date.now())=>!!row&&(row.status==='adult'||row.status==='approved'&&Date.parse(row.permission_expires_at)>now);
export async function assertPermission(database,lease=permissionContext.getStore()){
 if(!lease)return; // Direct repository tests/jobs have no HTTP lease.
 if(lease.signal?.aborted)throw permissionError();
 const row=(await database.query('SELECT status,revision,permission_expires_at FROM origen_eligibility WHERE subject_hash=$1',[createHash('sha256').update(lease.subject).digest('hex')])).rows[0];
 if(!eligibilityAllowed(row)||row.revision!==lease.revision)throw permissionError();
}
