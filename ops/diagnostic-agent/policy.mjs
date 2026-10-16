import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../diagnostics-gateway/capabilities.mjs';
import {exact,revision,fail,iso} from './contracts.mjs';
import {uuid} from '../../server/observability/wire.mjs';
const inside=(root,target)=>target===root||target.startsWith(root+path.sep);
export function relativeSource(value){return typeof value==='string'&&value.length<=200&&!value.includes('\\')&&!value.includes(':')&&!value.includes('%')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('.')&&!/^(?:output|tmp|temp|fixtures|__fixtures__|node_modules|uploads|credentials|secrets)$/i.test(p))&&/\.(?:mjs|js|ts|tsx|json|md|sql)$/.test(value)&&!/(?:private|secret|credential|\.env)/i.test(value);}
async function safeFile(root,relative,workspace){
 if(!relativeSource(relative))throw fail('source_denied');let current=root;for(const part of relative.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw fail('source_denied');}
 const resolved=await realpath(current);if(!inside(root,resolved)||workspace&&inside(workspace,resolved)||!(await lstat(resolved)).isFile())throw fail('source_denied');return resolved;
}
export async function loadPolicy({policyFile,expectedDigest,agentWorkspace,clock=Date.now}){
 const file=await realpath(policyFile),workspace=await realpath(agentWorkspace);if(inside(workspace,file)||!/^([a-f0-9]{64})$/.test(expectedDigest))throw fail('policy_denied');
 const bytes=await readFile(file);if(bytes.length>65536||hash(bytes)!==expectedDigest)throw fail('policy_denied');const policy=JSON.parse(bytes);
 exact(policy,['version','mode','environment','caseIds','sourceRoot','releases','runbooks','expiresAt']);
 // Provider/project processing approval is unresolved. This release deliberately
 // supports synthetic cases only, regardless of model-supplied approval claims.
 if(policy.version!==1||policy.mode!=='synthetic'||!['test','development'].includes(policy.environment)||!Array.isArray(policy.caseIds)||policy.caseIds.length>100||!policy.caseIds.every(uuid)||!iso(policy.expiresAt)||Date.parse(policy.expiresAt)<=clock()||!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(policy.sourceRoot)||!Array.isArray(policy.releases)||policy.releases.length>10||!Array.isArray(policy.runbooks)||policy.runbooks.length>20)throw fail('policy_denied');
 const root=path.dirname(file);if(inside(workspace,root))throw fail('policy_denied');
 const approved=new Map(),books=new Map();
 for(const release of policy.releases){exact(release,['revision','lockDigest','schemaId','configId','files']);if(!revision(release.revision)||!/^([a-f0-9]{64})$/.test(release.lockDigest)||![release.schemaId,release.configId].every(v=>/^[a-z0-9-]{1,60}$/.test(v))||!Array.isArray(release.files)||release.files.length>100)throw fail('policy_denied');for(const item of release.files){exact(item,['path','file','sha256']);if(!relativeSource(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256))throw fail('policy_denied');const key=release.revision+':'+item.path;if(approved.has(key))throw fail('policy_denied');approved.set(key,{...item,file:await safeFile(root,item.file,workspace)});}}
 for(const book of policy.runbooks){exact(book,['name','file','sha256']);if(!/^[a-z][a-z0-9-]{0,60}$/.test(book.name)||!/^([a-f0-9]{64})$/.test(book.sha256)||books.has(book.name))throw fail('policy_denied');books.set(book.name,{...book,file:await safeFile(root,book.file,workspace)});}
 const read=async entry=>{if(!entry)throw fail('source_denied');const target=await safeFile(root,path.relative(root,entry.file).split(path.sep).join('/'),workspace),stat=await lstat(target);if(stat.size>16384)throw fail('source_denied');const data=await readFile(target);if(hash(data)!==entry.sha256||data.includes(0))throw fail('source_denied');return {text:data.toString('utf8'),sha256:entry.sha256,provenance:'reviewed_release_evidence',instructions:'untrusted_data'};};
 return Object.freeze({digest:expectedDigest,environment:policy.environment,sourceRoot:policy.sourceRoot,caseAllowed:id=>policy.caseIds.includes(id)&&clock()<Date.parse(policy.expiresAt),release:rev=>policy.releases.find(r=>r.revision===rev),source:(rev,name)=>read(approved.get(rev+':'+name)),runbook:name=>read(books.get(name)),sourcePaths:()=>[...approved.values()].map(i=>i.path)});
}
