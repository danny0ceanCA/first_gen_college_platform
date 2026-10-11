// Synthetic identities and only the two new gate queries for older reporting
// unit tests. HTTP/RLS security tests use the real gate and database tables.
import {createAdminHandler} from './admin.mjs';
import {ADMIN_ACTIONS,MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
export function staffTestIdentity(sub,permissions=[...new Set(Object.values(ADMIN_ACTIONS))]){
 const time=Math.floor(Date.now()/1000);return {sub,permissions,iat:time,[MFA_TIME_CLAIM]:time,[AUTH_TIME_CLAIM]:time};
}
export function createAuditedAdminHandler(db,env){
 return createAdminHandler({...db,query:(sql,...args)=>sql.startsWith('SELECT blocked,token_valid_after')||sql.startsWith('INSERT INTO origen_privileged_access_audit')?Promise.resolve({rows:[]}):db.query(sql,...args)},env);
}
