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
import {createSupportHandler,assertSupportReady} from './support-diagnostics.mjs';
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
import {createDiagnosticHandler} from './diagnostics.mjs';
import {createLogger,runtimeLog} from './observability/logger.mjs';
import {createDiagnosticOperations,diagnosticOperationsEnabled,purgeDiagnosticOperations,assertDiagnosticOperationsReady,assertTelemetryLifecycle} from './observability/operations.mjs';
import {createDatabase,databaseReady} from './database.mjs';
import {createMaintenanceDatabase,assertMaintenanceAccess} from './maintenance-database.mjs';
import {createJobRunner} from './observability/jobs.mjs';
import {startRuntimeMetrics} from './observability/runtime.mjs';
import {exportConfiguration} from './observability/exporter.mjs';
import {isolateDatabase,assertRuntimeIsolation,runAsAccount} from './account-isolation.mjs';
import {createHistoryHandler} from './history.mjs';
import {createFamilyHandler} from './family.mjs';
import {createLinksHandler} from './account-links.mjs';
import {instrumentRequest,safeErrorCode} from './api-logging.mjs';
import {createGuidanceHandler,guidanceEnabled,purgeGuidanceHistory,bindGuidanceIdentity} from './guidance-history.mjs';
import {purgeAdminReviews} from './admin-review-queue.mjs';
import {purgeAdminReportSnapshots} from './admin-report-snapshots.mjs';

export function createApp(env=process.env,verify,database=null,writeLog,reviewOptions={}){
 assertProductionConfig(env);
 if(env.NODE_ENV==='production'&&Object.keys(reviewOptions).length)throw new Error('review_overrides_not_allowed');
 if(env.NODE_ENV==='production'&&database&&!database.isolated)throw new Error('isolated_database_required');
 assertProgressConfiguration(env);
 onboardingSettings(env);
 const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 const domain=env.AUTH0_DOMAIN,audience=env.AUTH0_AUDIENCE;
 const jwks=domain?createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)):null;
 const authenticate=verify||(async token=>{if(!jwks||!audience)throw new Error('Authentication not configured');return (await jwtVerify(token,jwks,{issuer:`https://${domain}/`,audience,algorithms:['RS256']})).payload;});
 const log=createLogger({env,sink:writeLog});
 const institutions=createInstitutionHandler(database,env);
 const inquiries=createInquiryHandler(database);
 const metrics=createMetricsHandler(database);
 const lifecycle=createLifecycleHandler(database);
 const permission=createPermissionHandler(database,env,reviewOptions.permission);
 const providerRequest=permissionFetch(database,env);
 const handlers=[createSupportHandler(database,env),createPrivacyHandler(database),createOnboardingHandler(database),createAdminHandler(database,env),createProgressHandler(database,env),createGuidanceHandler(database,env),lifecycle,metrics,institutions,inquiries,createCampaignHandler(database),createPlanHandler(database,env),createTopicNotesHandler(database,env,providerRequest),createSheetHandler(database),createLinksHandler(database),createFamilyHandler(database,database?createFamilyRepository(database,env):null),createHistoryHandler(database),createSummaryHandler(env,providerRequest,database),createDiagnosticHandler(log,database),createFinanceResearchHandler(env,providerRequest,log,database),createAdmissionsResearchHandler(env,providerRequest,log,database),createProfileVoiceHandler(env,providerRequest,log,database),createAIHandler(env,providerRequest,database)];
 const buckets=new Map();
 const mapOperation=createDiagnosticOperations(database);
 const privacyMonitor=createPrivacyMonitor(database,log);
 const app=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  apiSecurityHeaders(res,env.NODE_ENV==='production');
  const diagnostics=instrumentRequest(req,res,log,privacyMonitor.observe,log.metadata);
  let bound;
  req.bindDiagnosticOperation=async(kind,studentId)=>{
   if(!diagnosticOperationsEnabled(env)||!req.origenAuthorized||!req.origenIdentity?.sub)return;
   const hint=req.headers['x-origen-operation'];
   if(typeof hint!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(hint))return;
   if(bound){if(bound.kind!==kind||bound.studentId!==studentId)req.log({event:'telemetry.gap',reason:'mapping_scope_unavailable'});return;}
   const result=await mapOperation(req.origenIdentity.sub,{kind,studentId,hint,requestId:req.requestId});
   if(result.operationId){bound={kind,studentId};diagnostics.bind(result);if(!res.headersSent)res.setHeader('X-Origen-Operation-ID',result.operationId);}
   else req.log({event:'telemetry.gap',reason:result.reason});
  };
  return diagnostics.run(async()=>{
  const send=(status,error)=>{req.setDiagnosticCode(error);res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(req.url==='/healthz'&&req.method==='GET')return send(200);
  if(req.url==='/readyz'&&req.method==='GET')return await databaseReady(database)?send(200):send(503,'database_not_ready');
  if(!req.url?.startsWith('/api/'))return send(404,'not_found');
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return send(403,'origin_not_allowed');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','X-Request-ID, X-Origen-Operation-ID');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Origen-Session, X-Camino-Session, X-Origen-Segment, X-Origen-Operation');
   res.writeHead(204);return res.end();
  }
  if(req.method==='GET'&&/^\/api\/institutions\/(?:directory|(?:published|pages|qr)\/[a-z0-9-]{1,100})$/.test(req.url.split('?')[0]))return institutions(req,res,()=>send(404,'not_found'));
  if(req.method!=='POST')return send(405,'method_not_allowed');
  if(req.url==='/api/guardian-permission')return permission.handle(req,res,true);
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
  });
 };
 app.privacyMonitor=privacyMonitor;app.flushLogs=log.flush;return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let database,maintenancePool,jobs;
 let crashing=false;
 const fatal=()=>{if(crashing)return;crashing=true;runtimeLog({event:'service.crashed',code:'operation_failed'});setTimeout(()=>process.exit(1),1000).unref();void runtimeLog.flush().finally(()=>process.exit(1));};
 process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
 try{
 assertProductionConfig(process.env);
 exportConfiguration(process.env);
 for(const key of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS'])if(!process.env[key])throw new Error(`Missing ${key}`);
 const rawDatabase=createDatabase();
 database=rawDatabase?isolateDatabase(rawDatabase):null;
  if(database){await assertRuntimeIsolation(rawDatabase);if(diagnosticOperationsEnabled(process.env))await assertDiagnosticOperationsReady(rawDatabase);if(process.env.SUPPORT_DIAGNOSTICS_ENABLED==='true')await assertSupportReady(rawDatabase);if(process.env.OBSERVABILITY_EXPORT==='true')await assertTelemetryLifecycle(rawDatabase);if(!await databaseReady(database))throw new Error('database_migration_required');runtimeLog({event:'service.database.verified'});}
  else runtimeLog({event:'service.database.unavailable'});
  maintenancePool=createMaintenanceDatabase(process.env);
  if(maintenancePool)await assertMaintenanceAccess(maintenancePool);
  jobs=maintenancePool?createJobRunner(maintenancePool):null;
  const cleanupTasks=[
   ['permission-data',purgePermissionData],['diagnostic-maps',purgeDiagnosticOperations],['metrics',purgeMetrics],['invites',purgeExpiredInvites],
   ['private-summaries',purgePrivateSummaries],['privacy-events',purgePrivacyEvents],['inquiries',purgeInstitutionInquiries],['outreach',purgeInstitutionOutreach],
   ['guidance',purgeGuidanceHistory],['progress',purgeProgressHistory],['report-snapshots',purgeAdminReportSnapshots],['quality',purgeConversationQuality],
   ['onboarding',db=>purgeOnboardingEvents(db,new Date(),process.env)],['admin-reviews',db=>purgeAdminReviews(db,new Date(),process.env)],
  ];
  let cleanupBusy=false;
  const cleanup=async()=>{if(!jobs||cleanupBusy)return;cleanupBusy=true;try{for(const [name,work] of cleanupTasks)await jobs.run(name,work);}finally{cleanupBusy=false;}};
  await cleanup();
  const metricsCleanup=setInterval(()=>{void cleanup().catch(()=>runtimeLog({event:'retention.failed',code:'operation_failed'}));},60*60*1000);metricsCleanup.unref();
  const application=createApp(process.env,undefined,database),server=createServer(application);
  const stopRuntimeMetrics=startRuntimeMetrics(rawDatabase);
  const stopPermissionSupervisor=jobs?startPermissionSupervisor(null,process.env,fetch,jobs):()=>{};
  const emitPrivacyAlert=createPrivacyAlertEmitter(runtimeLog);
  let privacySweepBusy=false;
  const privacyAlerts=setInterval(()=>{if(!jobs||privacySweepBusy)return;privacySweepBusy=true;void jobs.run('privacy-alerts',db=>privacyAlertReport(db).then(emitPrivacyAlert)).catch(()=>runtimeLog({event:'privacy_monitor_gap',code:'alert_query_failed'})).finally(()=>{privacySweepBusy=false;});},60000);privacyAlerts.unref();
  if(runtimeLog.metadata.release==='unknown')runtimeLog({event:'service.configuration.invalid',code:'configuration_invalid'});
  server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>runtimeLog({event:'service.started'}));
  let stopping=false;
  const shutdown=()=>{
   if(stopping)return;stopping=true;runtimeLog({event:'service.stopping'});
   clearInterval(metricsCleanup);clearInterval(privacyAlerts);stopPermissionSupervisor();stopRuntimeMetrics();
   const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
   server.close(async()=>{try{await application.privacyMonitor.flush();await jobs?.stop();await maintenancePool?.end();await database?.end();await application.flushLogs();}finally{clearTimeout(deadline);}});
  };
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
 }catch(error){
  runtimeLog({event:'service.startup.failed',code:['telemetry_configuration_invalid','telemetry_lifecycle_required','restricted_database_runtime_required','database_migration_required','maintenance_database_required','restricted_maintenance_role_required','separate_maintenance_role_required','maintenance_migration_required'].includes(error?.message)?error.message:'startup_failed'});
  await jobs?.stop();await maintenancePool?.end().catch(()=>{});await database?.end().catch(()=>{});await runtimeLog.flush();process.exitCode=1;
 }
}
