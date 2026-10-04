import {pathToFileURL} from 'node:url';

// Return field names/reasons only. Never include configuration values or secrets.
export function productionConfigIssues(env){
 const issues=[];
 for(const name of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS','DATABASE_URL','OPENAI_API_KEY'])if(!env[name]?.trim())issues.push(`${name}: required`);
 if(env.AUTH0_DOMAIN&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(env.AUTH0_DOMAIN))issues.push('AUTH0_DOMAIN: use a hostname without protocol or path');
 if(env.ALLOWED_ORIGINS){
  const origins=env.ALLOWED_ORIGINS.split(',').map(x=>x.trim());
  if(origins.some(value=>{try{const u=new URL(value);return u.protocol!=='https:'||u.origin!==value||u.username||u.password||['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return true;}}))issues.push('ALLOWED_ORIGINS: exact HTTPS origins required; no wildcard, path or local origin');
 }
 if(env.DATABASE_URL){try{const u=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname||u.pathname==='/')issues.push('DATABASE_URL: PostgreSQL database URL required');}catch{issues.push('DATABASE_URL: invalid database URL');}}
 if(env.ALLOW_PREVIEW_VOICE&&!['true','false'].includes(env.ALLOW_PREVIEW_VOICE))issues.push('ALLOW_PREVIEW_VOICE: use true or false');
 return issues;
}
export function assertProductionConfig(env){
 if(env.NODE_ENV!=='production')return;
 const issues=productionConfigIssues(env);if(issues.length)throw new Error(`Production configuration rejected: ${issues.join('; ')}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const issues=productionConfigIssues(process.env);
 if(process.env.NODE_ENV!=='production')issues.unshift('NODE_ENV: set production for deployment');
 if(issues.length){for(const issue of issues)console.error(issue);process.exitCode=1;}
 else console.log('Production configuration syntax checks passed. Provider MFA, permissions, TLS, backups and processing agreements remain unverified.');
}
