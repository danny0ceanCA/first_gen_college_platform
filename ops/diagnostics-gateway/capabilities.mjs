import {createHash,sign,verify,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const fingerprint=scope=>hash(JSON.stringify([scope.id,scope.origin,scope.purpose,scope.environment,[...scope.operations].sort(),new Date(scope.start).toISOString(),new Date(scope.end).toISOString(),scope.dataClasses,new Date(scope.expiresAt).toISOString()]));
export function seal(payload,key){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${body}.${sign(null,Buffer.from(body),key).toString('base64url')}`;}
export function unseal(token,key,maxBytes=8192){
 if(typeof token!=='string'||token.length>maxBytes)throw new Error('support_unavailable');const parts=token.split('.');
 if(parts.length!==2||!parts.every(p=>/^[\w-]+$/.test(p))||!verify(null,Buffer.from(parts[0]),key,Buffer.from(parts[1],'base64url')))throw new Error('support_unavailable');
 return JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
}
export const verifyManifest=(token,key)=>unseal(token,key,65536);
export function newCapability({scope,actor,recipient,audience,clock=Date.now}){
 const now=Math.floor(clock()/1000);return {type:'investigation',id:randomUUID(),caseId:scope.id,scope:fingerprint(scope),actor:hash(actor.sub),actorIat:actor.iat,recipient:hash(recipient),environment:scope.environment,aud:audience,iat:now,exp:Math.min(now+900,Math.floor(Date.parse(scope.expiresAt)/1000))};
}
