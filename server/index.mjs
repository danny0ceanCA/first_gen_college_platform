import {createPermissionHandler,purgePermissionData} from './guardian-permission.mjs';
import {eligibilityAllowed} from './permission-context.mjs';
import {permissionFetch,runPermittedRequest,startPermissionSupervisor} from './permission-execution.mjs';
import {createPrivacyMonitor,privacyAlertReport,createPrivacyAlertEmitter,purgePrivacyEvents} from './privacy-monitor.mjs';
import {createPrivacyHandler,purgePrivateSummaries} from './privacy-controls.mjs';
import {createCampaignHandler} from './institution-campaigns.mjs';
import {createOnboardingHandler,purgeOnboardingEvents} from './onboarding-events.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';
import {purgeConversationQuality} from './conversation-quality-store.mjs';
import {purgeInstitutionOutreach} from './institution-outreach-data.mjs';
import {createInquiryHandler,purgeInstitutionInquiries} from './institution-inquiries.mjs';
import {createAdminHandler} from './admin.mjs';
import {createProgressHandler,assertProgressConfiguration,purgeProgressHistory} from './progress-history.mjs';
import {createFamilyRepository} from './family.mjs';
import {createInstitutionHandler} from './institutions.mjs';
import {assertProductionConfig} from './production-config.mjs';
import {createLifecycleHandler,accountClosed,purgeExpiredInvites} from './account-lifecycle.mjs';
import {createMetricsHandler,purgeMetrics} from './institution-metrics.mjs';
import {createPlanHandler} from './plans.mjs';
import {createTopicNotesHandler} from './topic-notes.mjs';
import {createSheetHandler} from './workspace-sheets.mjs';
import {createServer} from 'node:http';
import {apiSecurityHeaders} from './browser-security.mjs';
import {pathToFileURL} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createAIHandler} from './ai.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createFinanceResearchHandler} from './finance-research.mjs';
import {createAdmissionsResearchHandler} from './admissions-research.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createDiagnosticHandler,diagnosticRecord} from './diagnostics.mjs';
import {createDatabase,databaseReady} from './database.mjs';
import {isolateDatabase,assertRuntimeIsolation,runAsAccount,runRetentionJob} from './account-isolation.mjs';
import {createHistoryHandler} from './history.mjs';
import {createFamilyHandler} from './family.mjs';
import {createLinksHandler} from './account-links.mjs';
import {instrumentRequest,safeErrorCode} from './api-logging.mjs';
import {createGuidanceHandler,guidanceEnabled,purgeGuidanceHistory,bindGuidanceIdentity} from './guidance-history.mjs';
import {purgeAdminReviews} from './admin-review-queue.mjs';
import {purgeAdminReportSnapshots} from './admin-report-snapshots.mjs';

export function createApp(env=process.env,verify,database=null,writeLog=record=>console.log(JSON.stringify(record)),reviewOptions={}){
 assertProductionConfig(env);
 if(env.NODE_ENV==='production'&&Object.keys(reviewOptions).length)throw new Error('review_overrides_not_allowed');
 if(env.NODE_ENV==='production'&&database&&!database.isolated)throw new Error('isolated_database_required');
 assertProgressConfiguration(env);
 onboardingSettings(env);
 const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 const domain=env.AUTH0_DOMAIN,audience=env.AUTH0_AUDIENCE;
 const jwks=domain?createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)):null;
 const authenticate=verify||(async token=>{if(!jwks||!audience)throw new Error('Authentication not configured');return (await jwtVerify(token,jwks,{issuer:`https://${domain}/`,audience,algorithms:['RS256']})).payload;});
 const log=input=>writeLog(diagnosticRecord(input));
 const institutions=createInstitutionHandler(database,env);
 const inquiries=createInquiryHandler(database);
 const metrics=createMetricsHandler(database);
 const lifecycle=createLifecycleHandler(database);
 const permission=createPermissionHandler(database,env,reviewOptions.permission);
 const providerRequest=permissionFetch(database,env);
 const handlers=[createPrivacyHandler(database),createOnboardingHandler(database),createAdminHandler(database,env),createProgressHandler(database,env),createGuidanceHandler(database,env),lifecycle,metrics,institutions,inquiries,createCampaignHandler(database),createPlanHandler(database,env),createTopicNotesHandler(database,env,providerRequest),createSheetHandler(database),createLinksHandler(database),createFamilyHandler(database,database?createFamilyRepository(database,env):null),createHistoryHandler(database),createSummaryHandler(env,providerRequest,database),createDiagnosticHandler(log,database),createFinanceResearchHandler(env,providerRequest,log,database),createAdmissionsResearchHandler(env,providerRequest,log,database),createProfileVoiceHandler(env,providerRequest,log,database),createAIHandler(env,providerRequest,database)];
 const buckets=new Map();
 const privacyMonitor=createPrivacyMonitor(database,writeLog);
 const app=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  apiSecurityHeaders(res,env.NODE_ENV==='production');
  instrumentRequest(req,res,writeLog,privacyMonitor.observe);
  const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(req.url==='/healthz'&&req.method==='GET')return send(200);
  if(req.url==='/readyz'&&req.method==='GET')return await databaseReady(database)?send(200):send(503,'database_not_ready');
  if(!req.url?.startsWith('/api/'))return send(404,'not_found');
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return send(403,'origin_not_allowed');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','X-Request-ID');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Origen-Session, X-Camino-Session, X-Origen-Segment');
   res.writeHead(204);return res.end();
  }
  if(req.method==='GET'&&/^\/api\/institutions\/(?:directory|(?:published|pages|qr)\/[a-z0-9-]{1,100})$/.test(req.url.split('?')[0]))return institutions(req,res,()=>send(404,'not_found'));
  if(req.method!=='POST')return send(405,'method_not_allowed');
  if(req.url==='/api/guardian-permission'){
   const key=`guardian:${req.socket.remoteAddress||'unknown'}`,now=Date.now();
   for(const [k,v] of buckets)if(v.reset<now)buckets.delete(k);
   const budget=buckets.get(key)||{count:0,reset:now+60000};buckets.set(key,budget);
   if(++budget.count>30)return send(429,'rate_limited');
   return permission.handle(req,res,true);
  }
  if(req.url==='/api/institution-inquiries/public')return inquiries(req,res,()=>send(404,'not_found'));
  if(req.url==='/api/institution-metrics/event')return metrics(req,res,()=>send(404,'not_found'));
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token)return send(401,'authentication_required');
  let identity;
  {try{identity=await authenticate(token);if(typeof identity.sub!=='string'||!identity.sub.trim()||identity.sub.length>255||domain&&identity.iss!==undefined&&identity.iss!==`https://${domain}/`)throw new Error();}catch{return send(401,'invalid_token');}}
  req.origenIdentity=identity;
  const now=Date.now();for(const [key,value] of buckets)if(value.reset<now)buckets.delete(key);
  const bucketKey=`account:${identity.sub}`;
  const bucket=buckets.get(bucketKey)||{count:0,reset:now+60000};buckets.set(bucketKey,bucket);
  if(++bucket.count>120){res.setHeader('Retry-After','60');return send(429,'rate_limited');}
  // Apply the account budget before database lookups so excess traffic cannot
  // consume a closure-status query on every rejected request.
  return runAsAccount(identity,async()=>{
  if(identity&&database){try{if(await accountClosed(database,identity.sub))return send(403,'account_closed');}catch(error){req.log({event:'database_error',code:safeErrorCode(error)});return send(503,'account_status_unavailable');}}
  req.origenAuthorized=true;
  req.origenPreview=false;
  req.origenIdentity=identity;
  if(req.url==='/api/eligibility')return permission.handle(req,res);
  const exempt=new Set(['/api/account-data','/api/privacy','/api/admin','/api/institutions','/api/institution-campaigns','/api/institution-inquiries/staff','/api/institution-metrics/report']);
  const protectedRequest=!exempt.has(req.url?.split('?')[0]);
  let eligibility;
  if(protectedRequest){
   try{eligibility=await permission.repository.read(identity.sub);}catch(error){req.log({event:'database_error',code:safeErrorCode(error)});return send(503,'permission_unavailable');}
   if(!eligibilityAllowed(eligibility))return send(403,'permission_required');
  }
  const dispatch=async()=>{
  if(identity&&database&&guidanceEnabled(env)){
   try{await bindGuidanceIdentity(database,identity.sub,`https://${domain}/`);}catch(error){if(error.status!==404)return send(error.status===403?403:503,'identity_mapping_unavailable');}
  }
  let i=0;const next=()=>{const handler=handlers[i++];return handler?handler(req,res,next):send(404,'not_found');};
  try{
   await next();
  }catch(error){req.log({event:'api_error',level:'error',code:safeErrorCode(error)});if(!res.headersSent)send(500,'server_error');else res.end();}
  };
  if(protectedRequest)return runPermittedRequest(database,identity.sub,eligibility.revision,req,res,dispatch);
  return dispatch();
  });
 };
 app.privacyMonitor=privacyMonitor;return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assertProductionConfig(process.env);
 for(const key of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS'])if(!process.env[key])throw new Error(`Missing ${key}`);
 const rawDatabase=createDatabase();
 const database=rawDatabase?isolateDatabase(rawDatabase):null;
 try{
  if(database){await assertRuntimeIsolation(rawDatabase);if(!await databaseReady(database))throw new Error('database_migration_required');console.log('Origen restricted database runtime verified.');}
  else console.warn('DATABASE_URL is not set; persistent storage is unavailable.');
  await runRetentionJob(async()=>{
  await purgePermissionData(database);
  await purgeMetrics(database);
  await purgeExpiredInvites(database);
  await purgePrivateSummaries(database);
  await purgePrivacyEvents(database);
  await purgeInstitutionInquiries(database);
  await purgeInstitutionOutreach(database);
  await purgeGuidanceHistory(database);
  await purgeProgressHistory(database);
  await purgeAdminReportSnapshots(database);
  await purgeConversationQuality(database);
  await purgeOnboardingEvents(database,new Date(),process.env);
  });
  const metricsCleanup=setInterval(()=>{void runRetentionJob(()=>Promise.all([purgePermissionData(database),purgePrivacyEvents(database),purgePrivateSummaries(database),purgeAdminReportSnapshots(database),purgeMetrics(database),purgeInstitutionInquiries(database),purgeInstitutionOutreach(database),purgeExpiredInvites(database),purgeGuidanceHistory(database),purgeProgressHistory(database),purgeConversationQuality(database),purgeOnboardingEvents(database,new Date(),process.env)]).then(()=>purgeAdminReviews(database,new Date(),process.env))).catch(()=>console.error('Origen retention cleanup failed.'));},60*60*1000);metricsCleanup.unref();
  const application=createApp(process.env,undefined,database),server=createServer(application);
  const stopPermissionSupervisor=startPermissionSupervisor(database,process.env);
  const emitPrivacyAlert=createPrivacyAlertEmitter(record=>console.log(JSON.stringify(record)));
  let privacySweepBusy=false;
  const privacyAlerts=setInterval(()=>{if(!database||privacySweepBusy)return;privacySweepBusy=true;void runRetentionJob(()=>privacyAlertReport(database).then(emitPrivacyAlert)).catch(()=>console.error(JSON.stringify({event:'privacy_monitor_gap',code:'alert_query_failed',level:'error'}))).finally(()=>{privacySweepBusy=false;});},60000);privacyAlerts.unref();
  server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Origen API listening'));
  let stopping=false;
  const shutdown=()=>{
   if(stopping)return;stopping=true;
   clearInterval(metricsCleanup);clearInterval(privacyAlerts);stopPermissionSupervisor();
   const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
   server.close(async()=>{try{await application.privacyMonitor.flush();await database?.end();}finally{clearTimeout(deadline);}});
  };
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
 }catch(error){
  console.error(['restricted_database_runtime_required','database_migration_required'].includes(error.message)?`Origen startup stopped: ${error.message}. Follow docs/PRIVACY_SECURITY_PHASE_2.md; migrations require a separate credential.`:'Origen database initialization failed. Check DATABASE_URL and database availability.');
  await database?.end();process.exitCode=1;
 }
}
