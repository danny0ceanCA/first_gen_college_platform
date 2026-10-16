import {createHash,verify} from 'node:crypto';
import {profiles} from './profiles.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const deny = () => {throw new Error('runner_denied');};
export function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))deny();}
const sha = v => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid = v => typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function sourcePath(p){
 if(typeof p!=='string'||p.length>180||! /^(?:src|server|scripts)\/[a-zA-Z0-9_./-]+\.(?:mjs|cjs|js|ts|mts|cts|tsx|css|svg|sql|json)$|^(?:package(?:-lock)?\.json|index\.html|tsconfig(?:\.app|\.node)?\.json|vite\.config\.ts)$/.test(p)||p.split('/').some(s=>!s||s.startsWith('.'))||/(?:credential|secret|upload|dump|telemetry-data)/i.test(p)||/fixture/i.test(p)&&p!=='server/family-fixture.mjs')deny();
 return p;
}
// Only synthetic output is eligible for release. Detection quarantines, never redacts into a claimed safe result.
export function sensitive(text){return /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|-----BEGIN [^-]*PRIVATE KEY|(?:sk-|ghp_|github_pat_)[a-z0-9_-]{12,}|(?:postgres(?:ql)?|https?):\/\/[^\s]+|\b(?:Bearer|password|access_token|client_secret)\s*[:= ]\s*\S+|REAL[_ -]?(?:USER|DATA|TRANSCRIPT)|\b\d{3}-\d{2}-\d{4}\b)/i.test(text);}
export function prepare(bundle,patch,release){
 exact(bundle,['revision','files']);if(bundle.revision!==release.revision||!Array.isArray(bundle.files)||bundle.files.length>4000)deny();
 const expected=new Map(release.files.map(f=>[sourcePath(f.path),f.sha256]));if(expected.size!==release.files.length||bundle.files.length!==expected.size)deny();
 const files=new Map();let bytes=0;
 for(const f of bundle.files){exact(f,['path','content']);sourcePath(f.path);if(typeof f.content!=='string'||f.content.includes('\0')||files.has(f.path)||hash(f.content)!==expected.get(f.path)||(bytes+=Buffer.byteLength(f.content))>16*1024*1024)deny();files.set(f.path,f.content);}
 if(hash(files.get('package-lock.json')??'')!==release.lockDigest)deny();
 exact(patch,['files']);if(!Array.isArray(patch.files)||patch.files.length>20)deny();const seen=new Set();
 for(const f of patch.files){exact(f,['path','before','content']);sourcePath(f.path);
  if(!/^(?:src|server)\//.test(f.path)||f.path.endsWith('.json')||seen.has(f.path)||typeof f.content!=='string'||f.content.includes('\0')||Buffer.byteLength(f.content)>256*1024||sensitive(f.content))deny();
  if(files.has(f.path)?f.before!==hash(files.get(f.path)):f.before!==null||!['server/runner-regression.test.mjs','server/permission-runner-regression.test.mjs'].includes(f.path))deny();
  seen.add(f.path);files.set(f.path,f.content);
 }
 return {files:[...files].map(([path,content])=>({path,content})),patchDigest:hash(JSON.stringify(patch))};
}
export function grant(envelope,publicKey,expected,now=Date.now()){
 exact(envelope,['payload','signature']);const p=envelope.payload;
 exact(p,['version','id','caseId','investigationId','revision','patchDigest','testProfile','image','expiresAt','action','environment']);
 if(p.version!==1||!uuid(p.id)||!uuid(p.caseId)||!uuid(p.investigationId)||p.action!=='synthetic_test'||p.environment!=='test'||!sha(p.patchDigest)||!Object.hasOwn(profiles,p.testProfile)||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)>now+600000||typeof envelope.signature!=='string'||!verify(null,Buffer.from(JSON.stringify(p)),publicKey,Buffer.from(envelope.signature,'base64')))deny();
 for(const key of ['caseId','investigationId','revision','patchDigest','testProfile','image'])if(p[key]!==expected[key])deny();return p;
}
export function validatePolicy(policy){
 exact(policy,['version','environment','image','release','expiresAt']);exact(policy.release,['revision','lockDigest','files']);
 if(policy.version!==1||policy.environment!=='test'||!/^[-a-z0-9./:]+@sha256:[a-f0-9]{64}$/.test(policy.image)||!sha(policy.release.lockDigest)||! /^[a-f0-9]{40}$/.test(policy.release.revision)||!Array.isArray(policy.release.files)||policy.release.files.some(f=>{exact(f,['path','sha256']);return !sha(f.sha256);})||Date.parse(policy.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(policy.expiresAt)))deny();return policy;
}
