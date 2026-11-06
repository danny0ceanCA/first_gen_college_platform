// An explicitly isolated preview of the real AdminDashboard. It never loads .env,
// starts the student app, connects to a service database, or calls a paid model.
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isAbsolute,relative,resolve} from 'node:path';
import {createServer} from 'vite';
import {createAdminHandler} from '../../server/admin.mjs';
import {AUTH_TIME_CLAIM} from '../../server/recent-auth.mjs';
import {createNetworkEffectsRepository,migrateNetworkEffects} from '../../server/network-effects/repository.mjs';
import {createPGlitePool} from '../../server/network-effects/pglite-test-pool.mjs';
import {demoSources} from './fixtures.mjs';
import {createSyntheticExtractor} from './extractor.mjs';
import {extractionSchema,validateSource} from './contracts.mjs';
import {verificationHash} from './verification-contracts.mjs';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const previewRoot=fileURLToPath(new URL('./admin-preview/',import.meta.url));
const extractionFields=extractionSchema.properties.items.items.anyOf[0].required;
const sourceKey=source=>JSON.stringify([source.id,source.version]);
const same=(left,right)=>verificationHash(left)===verificationHash(right);
const previewFail=code=>{throw new Error(code);};
function fictionalReport(report){
 if(!['network-effects-real-extraction-calibration','network-effects-verification-calibration'].includes(report?.kind)
  ||!Array.isArray(report.records))previewFail('preview_report_requires_fictional_calibration');
 for(const record of report.records){
  for(const source of [record.source,...(record.pipeline?.sources||[]),...(record.pipeline?.sourceHistory||[]),...(record.history?.source?[record.history.source]:[])]){
   if(source?.synthetic!==true)previewFail('preview_report_requires_fictional_calibration');
   validateSource(source);
  }
 }
 return report;
}
// Strip projection metadata and restore within-source links to local keys. The
// repository recreates the same canonical IDs from unchanged source IDs/versions.
function replayExtraction(source,items){
 const local=new Map(items.map(item=>[`${source.id}@${source.version}#${item.key}`,item.key]));
 return {schemaVersion:1,items:items.map(item=>Object.fromEntries(extractionFields.map(field=>[field,
  ['linksTo','corrects'].includes(field)?local.get(item[field])||item[field]:item[field]]))).sort((a,b)=>a.key.localeCompare(b.key))};
}

/** Replays saved fictional results only; no extractor/verifier is invoked here. */
export async function replayPreviewReport(repository,rawReport){
 const report=fictionalReport(rawReport);
 if(report.kind==='network-effects-real-extraction-calibration'){
  const latest=new Map(report.records.map(record=>[record.source.id,record]));
  for(const record of report.records){
   if(latest.get(record.source.id)!==record)continue;
   const queued=await repository.ingest(record.source,'calibration-replay');
   const job=await repository.claim({jobId:queued.id});
   if(record.valid)await repository.complete(job,record.actual,record.diagnostic?.durationMs||0);
   else await repository.failure(job,{code:'invalid_extraction'},{maxAttempts:1});
  }
  return;
 }
 const restored=new Map();
 const remembered=(source,status,extraction)=>({source,status,extraction:extraction&&replayExtraction(source,extraction.items)});
 async function restorePrior(source,savedJob,items){
  const extraction=savedJob.status==='completed'?replayExtraction(source,items):null;
  const signature=remembered(source,savedJob.status,extraction),key=sourceKey(source);
  if(restored.has(key)){
   if(!same(restored.get(key),signature))previewFail('preview_history_conflict');
   return;
  }
  const queued=await repository.ingest(source,savedJob.extractorVersion);
  if(savedJob.status!=='queued'){
   const job=await repository.claim({jobId:queued.id,maxAttempts:10,leaseMs:600000});
   if(savedJob.status==='completed')await repository.complete(job,extraction,savedJob.durationMs||0);
   else if(savedJob.status==='failed')await repository.failure(job,{code:savedJob.error||'verification_failed'},{maxAttempts:1});
   else if(savedJob.status!=='running')previewFail('preview_unsupported_job_state');
  }
  restored.set(key,signature);
 }
 for(const record of report.records){
  const {source,history,pipeline}=record;
  if(!history?.job||!Array.isArray(history.attempts)||!Array.isArray(pipeline?.jobs)||!Array.isArray(pipeline?.episodes)
   ||!same(history.source,source)||history.job.sourceId!==source.id||history.job.sourceVersion!==source.version)
   previewFail('preview_verification_history_required');
  const index=pipeline.jobs.findIndex(job=>job.id===history.job.id);
  if(index<0)previewFail('preview_verification_history_required');
  const versions=new Map((pipeline.sourceHistory||pipeline.sources||[]).map(input=>[sourceKey(input),input]));
  const items=pipeline.episodes.flatMap(episode=>episode.items||[]);
  for(const savedJob of pipeline.jobs.slice(0,index)){
   const prior=versions.get(JSON.stringify([savedJob.sourceId,savedJob.sourceVersion]));
   if(!prior||prior.accountId!==source.accountId||prior.studentId!==source.studentId)previewFail('preview_prior_source_missing');
   await restorePrior(prior,savedJob,items.filter(item=>item.sourceId===prior.id&&item.sourceVersion===prior.version));
  }
  if(restored.has(sourceKey(source)))previewFail('preview_duplicate_verification_source');
  const queued=await repository.ingest(source,history.job.extractorVersion);
  const attempts=[...history.attempts].sort((a,b)=>a.attempt-b.attempt);
  if(attempts.length>10||attempts.some((attempt,index)=>attempt.attempt!==index+1))previewFail('preview_invalid_verification_attempts');
  if(!same(record.audit,attempts.at(-1)?.audit||null))previewFail('preview_verification_history_conflict');
  for(let index=0;index<Math.max(1,attempts.length);index++){
   const job=await repository.claim({jobId:queued.id,maxAttempts:10,leaseMs:600000}),audit=attempts[index]?.audit;
   if(audit){
    if(audit.decision==='skipped')await repository.recordVerification(job,audit);
    else{
     // This reconstructs the documented pending state without changing the
     // recorded context fingerprint. The repository independently validates it.
     const pending={...audit,decision:'pending',final:null,issues:[],steps:audit.steps.filter(step=>step.stage==='extraction')};
     await repository.recordVerification(job,pending);
     if(audit.decision!=='pending')await repository.recordVerification(job,audit);
    }
   }
   const last=index===Math.max(1,attempts.length)-1;
   if(last&&record.valid){
    if(!audit||!['kept','revised','skipped'].includes(audit.decision))previewFail('preview_verified_result_required');
    await repository.complete(job,record.actual,record.durationMs||0);
   }else if(last&&history.job.status==='running'&&audit?.decision==='pending'){
    // A captured in-progress check stays visibly pending in the preview.
   }else await repository.failure(job,{code:last?record.errorCode||'verification_failed':'verification_failed'},
    {maxAttempts:last?index+1:10,retryDelayMs:0});
  }
  const replayed=await repository.getVerification(queued.id);
  if(replayed.attempts.length!==attempts.length||replayed.attempts.some((attempt,index)=>!same(attempt.audit,attempts[index].audit)))
   previewFail('preview_verification_replay_mismatch');
  restored.set(sourceKey(source),remembered(source,replayed.job.status,record.valid?record.actual:null));
 }
}
export async function startAdminPreview({port=8792,enabled=true,readOnly=false,reportPath,replayReport=false}={}){
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('invalid_preview_port');
 if(replayReport&&!reportPath)throw new Error('preview_replay_requires_report');
 const {PGlite}=await import(new URL('./.local/pg-test-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url));
 const db=new PGlite();const pool=createPGlitePool(db);
 const repository=createNetworkEffectsRepository(pool),extract=createSyntheticExtractor();
 try{
 await migrateNetworkEffects(pool);
 for(const source of replayReport?[]:demoSources()){
  const queued=await repository.ingest(source,'synthetic-preview-v1');
  const job=await repository.claim({jobId:queued.id});
  const context=await repository.contextFor(source);
  await repository.complete(job,await extract(source,context),0);
 }
 const first=(await repository.listEpisodes({page:1,pageSize:1})).items[0];
 if(first)await repository.review({episodeId:first.id,expectedRevision:first.revision,decision:'needs-review',note:'Fictional preview: inspect the original wording and its interpretation.'},'preview-seed');
 if(reportPath){
  const base=fileURLToPath(new URL('./.local/calibration/',import.meta.url));
  const file=resolve(reportPath),within=relative(base,file);
  if(within.startsWith('..')||isAbsolute(within))throw new Error('preview_report_must_be_in_local_calibration');
  const raw=await readFile(file,'utf8');if(Buffer.byteLength(raw)>8_000_000)throw new Error('preview_report_too_large');
  const report=fictionalReport(JSON.parse(raw));
  if(replayReport)await replayPreviewReport(repository,report);
  await repository.recordEvaluation(report,{actor:'preview-import'});
 }
 }catch(error){await db.close();throw error;}
 const token=randomBytes(32).toString('base64url'),subject='network-preview-admin';
 const audit=[];
 const staffDatabase={query:async(sql,args)=>{
  if(sql.startsWith('SELECT blocked,token_valid_after FROM origen_staff_access_controls'))return {rows:[]};
  if(sql.startsWith('INSERT INTO origen_privileged_access_audit')){audit.push({id:args[0],action:args[3],outcome:args[5]});return {rows:[],rowCount:1};}
  throw new Error('preview_disallowed_staff_query');
 }};
 const env={NETWORK_EFFECTS_ENABLED:enabled?'true':'false'};
 const handler=createAdminHandler(staffDatabase,env,{networkRepository:repository});
 const origin=`http://127.0.0.1:${port}`;
 const server=await createServer({
  root:previewRoot,configFile:false,envFile:false,publicDir:false,logLevel:'error',
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('')},
  resolve:{alias:{'@auth0/auth0-react':resolve(previewRoot,'auth.ts')}},
  esbuild:{jsx:'automatic'},
  server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[projectRoot]},headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:"+port}},
  plugins:[{name:'isolated-network-admin-api',configureServer(vite){vite.middlewares.use((req,res,next)=>{
   const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'loopback_preview_only'});
   if(req.url?.split('?')[0]==='/__network-preview/session'){
    if(req.method!=='GET')return send(405,{error:'method_not_allowed'});
    return send(200,{token,subject});
   }
   if(!req.url?.startsWith('/api/'))return next();
   if(req.url?.split('?')[0]!=='/api/admin')return send(404,{error:'preview_route_not_available'});
   if(req.headers.authorization!==`Bearer ${token}`)return send(401,{error:'preview_authentication_required'});
   const now=Math.floor(Date.now()/1000);
   req.origenAuthorized=true;req.origenIdentity={sub:subject,iat:now,[AUTH_TIME_CLAIM]:now,permissions:['read:network-effects',...readOnly?[]:['write:network-effects-review']]};
   void handler(req,res,()=>send(404,{error:'not_found'})).catch(()=>send(500,{error:'preview_request_failed'}));
  });}}],
 });
 try{await server.listen();}catch(error){await server.close();await db.close();throw error;}
 return {url:origin,repository,audit,close:async()=>{await server.close();await db.close();}};
}

async function main(args){
 if(args.includes('--help')){console.log('node research/network-effects/admin-preview.mjs [--port 8792] [--disabled] [--read-only] [--report research/network-effects/.local/calibration/<run>/report.json] [--replay-report]\nFictional in-memory PostgreSQL preview. Replay replaces the reference demo with validated real model outputs from a fictional report. Requires the isolated PGlite test runtime; no .env or service database is used.');return;}
 const options={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--disabled')options.enabled=false;
  else if(args[i]==='--read-only')options.readOnly=true;
  else if(args[i]==='--replay-report')options.replayReport=true;
  else if(args[i]==='--port'&&args[i+1])options.port=Number(args[++i]);
  else if(args[i]==='--report'&&args[i+1])options.reportPath=args[++i];
  else throw new Error('invalid_preview_argument');
 }
 const preview=await startAdminPreview(options);console.log(`Isolated Network Effect Architecture admin: ${preview.url}`);
 const stop=()=>{void preview.close().finally(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
