import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {adminCapabilities,requireStaffAccess} from './staff-access.mjs';
import {runAsAccount,runAsAnalytics} from './account-isolation.mjs';
import {validateTeachingRequest} from './teaching-library.mjs';
import {readAdminVoiceTeachings,liveTeachingDeliveryUpdates} from './admin-voice-teachings.mjs';
import {createTeachingEvidence} from './admin-voice-evidence.mjs';
import {adminVoiceSession,draftInstructions,teachingDraftSchema} from './admin-voice-prompts.mjs';
import {createCostLedger,rateCard} from './admin-voice-cost.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const topics=['general','profile','planning','finance','loans','admissions'];
const fail=(status,message)=>Object.assign(new Error(message),{status});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function validateVoiceStart(input){
 if(!uuid.test(input.id)||!['test','teach'].includes(input.mode)||!['gpt-live-1','gpt-realtime-2.1'].includes(input.model)||!['en','es'].includes(input.language)||!topics.includes(input.topic)||![2,5].includes(input.minutes))throw fail(400,'invalid_voice_request');
 if(input.mode==='teach'&&input.model!=='gpt-realtime-2.1')throw fail(400,'invalid_voice_request');
 for(const [key,max] of [['scenario',1500],['campus',160],['academicYear',7]])if(typeof input[key]!=='string'||input[key].length>max)throw fail(400,'invalid_voice_request');
 if(input.academicYear&&!/^\d{4}-\d{2}$/.test(input.academicYear)||typeof input.sdp!=='string'||!input.sdp.startsWith('v=0')||input.sdp.length>100000)throw fail(400,'invalid_voice_request');
 if(input.verifyTeachings!==undefined&&typeof input.verifyTeachings!=='boolean')throw fail(400,'invalid_voice_request');
 return {...Object.fromEntries(['id','mode','model','language','topic','minutes','scenario','campus','academicYear'].map(k=>[k,input[k]])),verifyTeachings:input.mode==='test'&&input.verifyTeachings===true};
}

export function createAdminVoiceHandler(database,env,request=fetch,Socket=WebSocket){
 const runs=new Map(),owners=new Set();
 const command=(identity,input)=>runAsAccount(identity,()=>runAsAnalytics(async()=>(await database.query('SELECT origen_admin_voice_command($1::jsonb) AS data',[JSON.stringify(input)])).rows[0].data));
 const refs=(run,topic,query)=>runAsAccount(run.identity,()=>runAsAnalytics(()=>readAdminVoiceTeachings(database,{...run.config,topic,query})));
 const view=run=>({...run.config,status:run.status,startedAt:run.startedAt,endedAt:run.endedAt,error:run.error||'',teachings:run.teachings,evidence:run.evidence.snapshot(),providerErrorCodes:run.providerErrorCodes,cost:run.ledger.snapshot(run.status==='ended',run.created),draft:run.draft||null,draftError:run.draftError||'',draftAvailable:run.status==='ended'&&run.config.mode==='teach'&&run.transcript.some(x=>x.role==='user'),draftBusy:!!run.draftPromise});
 const persist=run=>{const data=view(run);run.persistence=(run.persistence||Promise.resolve()).catch(()=>{}).then(()=>command(run.identity,{action:'update',id:run.config.id,data}));return run.persistence;};
 const send=(run,event)=>{if(run.socket?.readyState!==1)return false;run.socket.send(JSON.stringify(event));return true;};
 function ready(run){
  if(run.status!=='active')return;run.evidence.ready();
  if(!run.outputTimer){run.outputTimer=setTimeout(()=>{const proof=run.evidence.snapshot();if(run.status==='active'&&!proof.outputTranscriptCharacters&&!proof.providerAudioChunks){run.error='voice_no_output';void stop(run);}},20000);run.outputTimer.unref?.();}
  if(run.config.model!=='gpt-live-1'||run.greetingSent)return;
  // Attached sidebands already belong to a running session. Send the greeting
  // after the browser confirms its media channel opened, rather than depending
  // on a one-shot session.started event arriving again on that data channel.
  run.greetingSent=send(run,{type:'session.commentary.append',event_id:randomUUID(),delegation_id:null,content:`Introduce yourself as Origen, the AI guide, in ${run.config.language==='es'?'Spanish':'English'}. Ask the caller to begin, then listen.`});
 }
 function finish(run,reason){
  if(run.finalized)return;run.finalized=true;run.status='ended';run.endedAt=new Date().toISOString();clearInterval(run.timer);clearTimeout(run.outputTimer);owners.delete(run.identity.sub);
  if(reason){run.error=reason;run.ledger.missing();}
  const proof=run.evidence.snapshot();if(!run.error&&proof.readyAt&&!proof.outputTranscriptCharacters&&!proof.providerAudioChunks)run.error='voice_no_output';
  void persist(run).catch(()=>{run.error='voice_save_failed';});
  run.socket?.close();
  run.expiry=setTimeout(()=>{run.transcript=[];runs.delete(run.config.id);},10*60*1000);run.expiry.unref?.();
 }
 async function stop(run){
  if(run.startPending){run.cancelRequested=true;await run.startDone;}
  if(run.finalized)return;
  if(run.stopPromise)return run.stopPromise;
  run.status='stopping';
  run.stopPromise=(async()=>{
   if(!run.created){finish(run,run.error||'voice_start_incomplete');return;}
   if(run.config.model==='gpt-live-1'){
    send(run,{type:'session.close'});
    await Promise.race([run.closed,wait(6000)]);
    if(!run.finalized)finish(run,'final_usage_unconfirmed');
   }else{
    send(run,{type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:{type:'server_vad',create_response:false,interrupt_response:false}}}}});
    send(run,{type:'response.cancel'});
    // Keep the sideband alive to receive interrupted-response and transcription usage.
    await wait(1200);
    const deadline=Date.now()+4800;while(run.ledger.pending()&&Date.now()<deadline&&!run.finalized)await wait(150);
    if(run.providerId)try{const r=await request(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(run.providerId)}/hangup`,{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(6000)});if(!r.ok)run.ledger.missing();}catch{run.ledger.missing();}
    finish(run);
   }
   await run.persistence?.catch(()=>{});
  })();return run.stopPromise;
 }
 async function tool(run,item){
  let result;
  try{
   const args=JSON.parse(item.arguments||'{}');
   if(item.name!=='search_teaching_library'||!topics.includes(args.topic)||typeof args.query!=='string'||args.query.length>1500||run.tools.size>20||run.config.mode!=='test')throw Error('invalid_tool');
   const entries=await refs(run,args.topic,args.query);
   run.evidence.supplied(entries);
   if(run.config.model==='gpt-live-1'){const fresh=entries.filter(e=>!run.deliveryRefs.has(e.id+':'+e.revision));for(const content of liveTeachingDeliveryUpdates(fresh))send(run,{type:'session.instructions.append',event_id:randomUUID(),delegation_id:null,content});fresh.forEach(e=>run.deliveryRefs.add(e.id+':'+e.revision));}
   run.teachings.push({topic:args.topic,source:'tool',at:new Date().toISOString(),entries:entries.map(e=>({id:e.id,revision:e.revision,title:e.content.title}))});
   result={entries};
  }catch{result={error:'teaching_lookup_unavailable',instruction:'Do not invent a teaching. Explain that the library lookup could not complete.'};}
  if(!run.finalized)send(run,{type:run.config.model==='gpt-live-1'?'response.item.create':'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)}});
 }
 async function event(run,envelope){
  if(run.finalized)return;
  run.ledger.ingest(envelope);
  const e=envelope.type==='response.event'?envelope.event:envelope;
  if(e.type==='session.output_transcript.delta'||e.type==='response.output_audio_transcript.delta'){run.evidence.transcript(e.delta);if(typeof e.delta==='string'&&e.delta.length)clearTimeout(run.outputTimer);}
  if(e.type==='session.output_audio.delta'||e.type==='response.output_audio.delta'){run.evidence.audio();clearTimeout(run.outputTimer);}
  const batchKey=envelope.delegation_id||e.response_id||e.response?.id||'realtime';
  if(e.type==='conversation.item.input_audio_transcription.completed'){
   if(!run.transcribed.has(e.item_id)){run.transcribed.add(e.item_id);run.transcript.push({role:'user',content:String(e.transcript||'').slice(0,8000)});}
  }
  if(e.type==='response.output_audio_transcript.done')run.transcript.push({role:'assistant',content:String(e.transcript||'').slice(0,8000)});
  if(JSON.stringify(run.transcript).length>80000){run.error='interview_length_limit';void stop(run);}
  if(e.type==='response.output_item.done'&&e.item?.type==='function_call'&&!run.tools.has(e.item.call_id)){
   const promise=tool(run,e.item);run.tools.set(e.item.call_id,promise);run.batches.set(batchKey,[...(run.batches.get(batchKey)||[]),promise]);
  }
  if(['response.done','response.completed'].includes(e.type)&&run.batches.has(batchKey)){
   const batch=run.batches.get(batchKey);run.batches.delete(batchKey);await Promise.all(batch);
   if(run.status==='active')send(run,{type:'response.create'});
  }
  if(e.type==='session.closed'){finish(run);run.resolveClosed();}
  if(e.type==='error'&&!['response_cancel_not_active','response_cancel_not_found'].includes(e.error?.code)){
   const code=e.error?.code;if(typeof code==='string'&&/^[a-z0-9_]{1,80}$/.test(code)&&!run.providerErrorCodes.includes(code)&&run.providerErrorCodes.length<16)run.providerErrorCodes.push(code);
   run.error='voice_provider_error';run.ledger.missing();void stop(run);
  }
 }
 async function attach(run){
  const url=run.config.model==='gpt-live-1'?`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(run.providerId)}/attach`:`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(run.providerId)}`;
  const socket=new Socket(url,{headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},maxPayload:4*1024*1024});run.socket=socket;
  socket.on('message',raw=>{try{const e=JSON.parse(raw.toString());void event(run,e).catch(()=>{run.ledger.missing();run.error='voice_event_failed';void stop(run);});}catch{run.ledger.missing();}});
  socket.on('close',()=>{if(!run.finalized){
   run.ledger.missing();run.error=run.error||'connection_lost';
   // The primary browser connection can still be alive. Realtime must be hung up
   // even when its server-side monitoring socket fails.
   if(run.status!=='starting'&&run.status!=='stopping')void stop(run);
  }});
  socket.on('error',()=>{run.ledger.missing();});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(fail(502,'voice_monitor_unavailable')),8000);socket.once('open',()=>{clearTimeout(timer);resolve();});socket.once('error',()=>{clearTimeout(timer);reject(fail(502,'voice_monitor_unavailable'));});socket.once('close',()=>{clearTimeout(timer);reject(fail(502,'voice_monitor_unavailable'));});});
 }
 async function start(identity,input){
  const config=validateVoiceStart(input);
  if(!env.OPENAI_API_KEY)throw fail(503,'voice_not_configured');
  if(owners.has(identity.sub)||[...runs.values()].filter(r=>!r.finalized).length>=4)throw fail(409,'voice_already_active');
  owners.add(identity.sub);
  const run={config,identity,status:'starting',startedAt:new Date().toISOString(),created:false,ledger:createCostLedger(config.model),evidence:createTeachingEvidence(),providerErrorCodes:[],teachings:[],deliveryRefs:new Set(),tools:new Map(),batches:new Map(),transcript:[],transcribed:new Set(),lastPing:Date.now()};
  run.closed=new Promise(resolve=>run.resolveClosed=resolve);
  run.startPending=true;run.startDone=new Promise(resolve=>run.resolveStart=resolve);
  let reserved=false;
  try{
   // Reserve before the paid API call. A duplicate/retry never starts another call.
   await command(identity,{action:'create',id:config.id,data:view(run)});reserved=true;runs.set(config.id,run);
   const entries=config.mode==='test'?await refs(run,config.topic,config.scenario):[];
   run.evidence.supplied(entries);
   entries.forEach(e=>run.deliveryRefs.add(e.id+':'+e.revision));
   run.teachings.push({topic:config.topic,source:'initial',at:run.startedAt,entries:entries.map(e=>({id:e.id,revision:e.revision,title:e.content.title}))});
   const session=adminVoiceSession(config,entries),headers={Authorization:`Bearer ${env.OPENAI_API_KEY}`};let answer;
   if(config.model==='gpt-live-1'){
    const r=await request('https://api.openai.com/v1/live/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({session,transport:{type:'webrtc',sdp:input.sdp}}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw fail(502,r.status===403||r.status===404?'model_not_available':'voice_start_failed');
    const data=await r.json();run.providerId=data.session?.id;answer=data.transport?.sdp;run.created=true;
   }else{
    const body=new FormData();body.set('sdp',input.sdp);body.set('session',JSON.stringify(session));
    const r=await request('https://api.openai.com/v1/realtime/calls',{method:'POST',headers,body,signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw fail(502,r.status===403||r.status===404?'model_not_available':'voice_start_failed');
    run.providerId=r.headers.get('Location')?.split('/').pop();answer=await r.text();run.created=true;
   }
   if(!run.providerId||typeof answer!=='string'||!answer.startsWith('v=0'))throw fail(502,'voice_start_failed');
   await attach(run);
   if(run.cancelRequested)throw fail(409,'voice_start_cancelled');
   run.status='active';run.lastPing=Date.now();await persist(run);
   run.timer=setInterval(()=>{
    if(Date.now()-Date.parse(run.startedAt)>config.minutes*60000||Date.now()-run.lastPing>25000){void stop(run);return;}
    void persist(run).catch(()=>{run.error='voice_save_failed';void stop(run);});
   },5000);run.timer.unref?.();
   run.startPending=false;run.resolveStart();return {...view(run),sdp:answer};
  }catch(error){
   run.startPending=false;run.resolveStart();
   if(reserved){run.ledger.missing();run.error=error.status?error.message:'voice_start_failed';await stop(run);finish(run,run.error);}else owners.delete(identity.sub);
   if(['40001','23505'].includes(error.code))throw fail(409,'voice_already_active');
   throw error;
  }
 }
 async function draft(run){
  if(run.draft)return view(run);
  if(run.draftPromise){await run.draftPromise;return view(run);}
  if(!run.finalized||run.config.mode!=='teach'||!run.transcript.some(x=>x.role==='user'&&x.content.trim()))throw fail(409,'teaching_transcript_unavailable');
  run.draftPromise=(async()=>{
   run.draftError='';
   try{
    const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:rateCard.backend.model,service_tier:'default',store:false,instructions:draftInstructions+` Write in ${run.config.language==='es'?'Spanish':'English'}.`,input:run.transcript,reasoning:{effort:'low'},max_output_tokens:3500,text:{format:{type:'json_schema',name:'teaching_draft',strict:true,schema:teachingDraftSchema}}}),signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw Error('draft_failed');const result=await response.json();run.ledger.response(result);
    const text=result.output?.flatMap(item=>item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    const generated=JSON.parse(text);if(!generated.explanation?.trim())throw Error('teaching_not_captured');
    const content={...generated,topic:run.config.topic,language:run.config.language,campus:run.config.campus,academicYear:run.config.academicYear,sourceUrl:'',reviewBy:''};
    // Validate the draft as normal authoring data; model output cannot publish or choose IDs.
    run.draft=validateTeachingRequest({action:'save',id:run.config.id,revision:0,content}).content;
   }catch{run.ledger.missing();run.draftError='draft_failed';}
   finally{run.draftPromise=null;await persist(run);}
  })();await run.draftPromise;return view(run);
 }
 const handler=async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/admin-voice')return next();
  const respond=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST')return respond(405,{error:'method_not_allowed'});
  const identity=req.origenIdentity;
  if(!req.origenAuthorized||!identity?.sub)return respond(401,{error:'authentication_required'});
  const caps=adminCapabilities(identity,env);
  if(!caps.admin||!caps.permissions.includes('manage:institutions'))return respond(403,{error:'admin_required'});
  if(!database)return respond(503,{error:'database_unavailable'});
  if(!req.headers['content-type']?.startsWith('application/json'))return respond(415,{error:'json_required'});
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>110000)return respond(413,{error:'request_too_large'});}
   let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_voice_request');}
   if(!input||!['list','start','status','stop','draft','ready','playback'].includes(input.action))throw fail(400,'invalid_voice_request');
   if(input.action!=='list'&&!uuid.test(input.id))throw fail(400,'invalid_voice_request');
   await requireStaffAccess(database,identity,{scope:'admin',action:'voice-'+input.action,target:input.id,permission:'manage:institutions',env,fresh:['start','draft'].includes(input.action)});
   if(input.action==='list')return respond(200,{runs:await command(identity,{action:'list'}),configured:!!env.OPENAI_API_KEY,rateCard});
   if(input.action==='start')return respond(201,await start(identity,input));
   const run=runs.get(input.id);
   if(run&&run.identity.sub!==identity.sub)throw fail(404,'voice_run_not_found');
   if(!run){const saved=await command(identity,{action:'get',id:input.id});if(!saved)throw fail(404,'voice_run_not_found');if(input.action==='draft'){if(saved.draft)return respond(200,saved);throw fail(409,'teaching_transcript_unavailable');}if(saved.status==='ended')return respond(200,{...saved,draftAvailable:false});return respond(200,{...saved,status:'ended',cost:{...saved.cost,complete:false},draftAvailable:false,error:saved.error||'session_not_on_this_server'});}
   if(input.action==='stop')await stop(run);
   if(input.action==='ready')ready(run);
   if(input.action==='playback'&&run.status==='active')run.evidence.playback();
   if(input.action==='draft')return respond(200,await draft(run));
   run.lastPing=Date.now();return respond(200,view(run));
  }catch(error){return respond(error.status||503,{error:error.status?error.message:'voice_studio_unavailable'});}
 };
 handler.close=async()=>{await Promise.all([...runs.values()].map(stop));for(const r of runs.values())clearTimeout(r.expiry);runs.clear();};
 return handler;
}
