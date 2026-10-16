import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
// Operator files live outside agent-writable directories. Missing, stale or invalid means disabled.
export function capabilityEnabled(file,now=Date.now()){
 try{
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024||realpathSync(file)!==resolve(file)||process.platform!=='win32'&&(stat.mode&0o022))return false;
  const p=JSON.parse(readFileSync(file,'utf8'));
  return Object.keys(p).sort().join(',')==='enabled,expiresAt,version'&&p.version===1&&p.enabled===true&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now&&Date.parse(p.expiresAt)<=now+900000;
 }catch{return false;}
}
