import {pathToFileURL} from 'node:url';
import {onboardingConfigIssues} from './onboarding-settings.mjs';
import {exportConfiguration} from './observability/exporter.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {organizationConfigurationIssues} from './binder-organization-policy.mjs';
import {registrationMailConfig} from './registration-email.mjs';

// Return field names/reasons only. Never include configuration values or secrets.
export function productionConfigIssues(env){
 const issues=[...coordinatorConfigurationIssues(env),...organizationConfigurationIssues(env)];
 try{registrationMailConfig(env);}catch{issues.push('REGISTRATION_EMAIL: valid transport, HTTPS public URL, sender and provider key required');}
 for(const key of ['ORIGEN_VOICE_PREPARATION','ORIGEN_BINDER_JOBS','ORIGEN_BINDER_CORRECTIONS','ORIGEN_GUIDED_CONVERSATION','ORIGEN_CONVERSATION_CONTINUITY','ORIGEN_CONVERSATION_RECOVERY'])if(env[key]&&!['true','false'].includes(env[key]))issues.push(`${key}: use true or false`);
 if(env.ORIGEN_CONVERSATION_CONTINUITY==='true'&&env.ORIGEN_BINDER_CORRECTIONS!=='true')issues.push('ORIGEN_BINDER_CORRECTIONS: required for conversation continuity');
 if(env.ORIGEN_GUIDED_CONVERSATION==='true'&&env.ORIGEN_BINDER_CORRECTIONS!=='true')issues.push('ORIGEN_BINDER_CORRECTIONS: required for guided conversation');
 if(env.ORIGEN_CONVERSATION_RECOVERY==='true'&&env.ORIGEN_BINDER_JOBS!=='true')issues.push('ORIGEN_BINDER_JOBS: required for conversation recovery');
 if(env.ORIGEN_BINDER_JOBS==='true'&&!env.MAINTENANCE_DATABASE_URL)issues.push('MAINTENANCE_DATABASE_URL: required for binder background processing');
 if(env.OBSERVABILITY_EXPORT&&!['true','false'].includes(env.OBSERVABILITY_EXPORT))issues.push('OBSERVABILITY_EXPORT: use true or false');
 try{exportConfiguration(env);}catch{issues.push('OBSERVABILITY_EXPORT: verified HTTPS, lifecycle readiness, deployment record and backup horizon required');}
 if(env.OBSERVABILITY_DETAILED_SPANS&&!['true','false'].includes(env.OBSERVABILITY_DETAILED_SPANS))issues.push('OBSERVABILITY_DETAILED_SPANS: use true or false');
 if(env.OBSERVABILITY_OPERATION_LINKS&&!['true','false'].includes(env.OBSERVABILITY_OPERATION_LINKS))issues.push('OBSERVABILITY_OPERATION_LINKS: use true or false');
 if(env.PRIVACY_RESTORE_PENDING==='true')issues.push('PRIVACY_RESTORE_PENDING: replay and verify the latest deletion journal before serving restored data');
 if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')issues.push('NODE_TLS_REJECT_UNAUTHORIZED: certificate verification must remain enabled');
 if(env.DATABASE_TLS_MODE&&!['verify-full','render-internal'].includes(env.DATABASE_TLS_MODE))issues.push('DATABASE_TLS_MODE: use verify-full or render-internal');
 if(env.DATABASE_TLS_MODE==='render-internal'){
  let internal=false;try{internal=env.RENDER==='true'&&/^dpg-[a-z0-9-]+$/.test(new URL(env.DATABASE_URL).hostname);}catch{}
  if(!internal)issues.push('DATABASE_TLS_MODE: render-internal requires Render and a private dpg hostname');
 }
 if(env.AUTH0_MANAGEMENT_TOKEN?.trim())issues.push('AUTH0_MANAGEMENT_TOKEN: keep identity-deletion credentials in the operator environment only');
 if(env.MIGRATION_DATABASE_URL?.trim())issues.push('MIGRATION_DATABASE_URL: keep the migration credential out of the API environment; run migrations separately');
 for(const name of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS','DATABASE_URL','OPENAI_API_KEY'])if(!env[name]?.trim())issues.push(`${name}: required`);
 if(env.AUTH0_DOMAIN&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(env.AUTH0_DOMAIN))issues.push('AUTH0_DOMAIN: use a hostname without protocol or path');
 if(env.ALLOWED_ORIGINS){
  const origins=env.ALLOWED_ORIGINS.split(',').map(x=>x.trim());
  if(origins.some(value=>{try{const u=new URL(value);return u.protocol!=='https:'||u.origin!==value||u.username||u.password||['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return true;}}))issues.push('ALLOWED_ORIGINS: exact HTTPS origins required; no wildcard, path or local origin');
 }
 if(env.DATABASE_URL){try{const u=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname||u.pathname==='/')issues.push('DATABASE_URL: PostgreSQL database URL required');}catch{issues.push('DATABASE_URL: invalid database URL');}}
 if(env.ALLOW_PREVIEW_VOICE&&!['true','false'].includes(env.ALLOW_PREVIEW_VOICE))issues.push('ALLOW_PREVIEW_VOICE: use true or false');
 if(env.GUIDANCE_HISTORY_ENABLED&&!['true','false'].includes(env.GUIDANCE_HISTORY_ENABLED))issues.push('GUIDANCE_HISTORY_ENABLED: use true or false');
 if(env.GUIDANCE_HISTORY_ENABLED==='true'&&!env.GUIDANCE_DATA_OWNER?.trim())issues.push('GUIDANCE_DATA_OWNER: assign an operational data owner before enabling collection');
 if(env.GUIDANCE_HISTORY_ENABLED==='true'&&!env.RENDER_GIT_COMMIT?.trim()&&!env.APPLICATION_REVISION?.trim())issues.push('APPLICATION_REVISION: a build revision is required when guidance collection is enabled');
 if(env.GUIDANCE_LEGACY_ISSUER&&env.GUIDANCE_LEGACY_ISSUER!==`https://${env.AUTH0_DOMAIN}/`)issues.push('GUIDANCE_LEGACY_ISSUER: must match the verified configured tenant issuer');
 return [...issues,...onboardingConfigIssues(env)];
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
