import {safeErrorCode} from './api-logging.mjs';
import {createHistoryRepository,validateMemory} from './history.mjs';
import {allowedRequest} from './origin.mjs';
import {narrativeSummaryInstructions} from './summary-style.mjs';
import {createConversationOverview} from './conversation-overview.mjs';
import {guidanceEnabled,guidanceConfig,validateSummarySegments,deferSummaryAttribution,createGuidanceRepository} from './guidance-history.mjs';
export function createSummaryHandler(env,request=fetch,database=null){const overview=createConversationOverview(env,request,database);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/conversation-summary')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!allowedRequest(req)) return send(403,{error:'origin_not_allowed'});
 let execution,completed=false;const executionStarted=Date.now();
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_request'});}
 if(input?.action==='overview')return send(200,await overview(req,input));
 // A ten-minute session can easily exceed forty transcript entries. Bound
 // entry count separately from the existing 512 KB request-body limit.
 if(!input||!['en','es'].includes(input.language)||!Array.isArray(input.turns)||input.turns.length>400||input.turns.some(t=>!t||!['user','assistant'].includes(t.role)||typeof t.text!=='string'||t.text.length>12000))return send(400,{error:'invalid_request'});
 let metadata,attribution;
 if(req.origenAuthorized){
  if(!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  metadata=validateMemory({...input,summary:'pending'});
  if(guidanceEnabled(env)&&input.guidance){
   attribution={...input.guidance,language:input.language,configuration:guidanceConfig(env.OPENAI_MODEL_SUMMARY||env.OPENAI_MODEL_CONVERSATION||'gpt-4.1-mini','summary',{instructions:narrativeSummaryInstructions({...input,scopeName:'selected student'})},env)};
   try{await validateSummarySegments(database,req.origenIdentity.sub,metadata,attribution);}catch(error){if(error.status===404&&Date.parse(metadata.date)<Date.now()-90*86400000)attribution=undefined;else throw error;}
  }
  const previous=input.defer===true&&metadata.studentId!==null?{items:[]}:await createHistoryRepository(database)(req.origenIdentity.sub,{action:'find',id:metadata.id});
  const existing=previous.items.find(item=>item.id===metadata.id);if(existing){if(existing.studentId!==metadata.studentId||existing.mode!==metadata.mode)return send(409,{error:'summary_conflict'});if(attribution)await createHistoryRepository(database)(req.origenIdentity.sub,{action:'save',item:existing,attribution});return send(200,{summary:existing.summary,item:existing});}
 }
 if(!env.OPENAI_API_KEY)return send(503,{error:'missing_api_key'});
 if(attribution)execution=await createGuidanceRepository(database).startExecution(req.origenIdentity.sub,{sessionId:attribution.sessionId,segmentId:attribution.segmentIds.at(-1)},attribution.configuration,'summary');
 const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_MODEL_SUMMARY||env.OPENAI_MODEL_CONVERSATION||'gpt-4.1-mini',store:false,max_output_tokens:900,instructions:narrativeSummaryInstructions(input),input:JSON.stringify(input.turns)}),signal:AbortSignal.timeout(45000)});
 req.log?.({event:'upstream_response',operation:'conversation_summary',httpStatus:response.status,upstreamRequestId:response.headers?.get('x-request-id')||undefined});
 if(!response.ok)return send(502,{error:'summary_unavailable'});const data=await response.json();if(data.status&&data.status!=='completed')return send(502,{error:'incomplete_summary'});const summary=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');if(!summary.trim())return send(502,{error:'empty_summary'});const item=metadata?{...metadata,summary:summary.slice(0,4000)}:undefined;
 if(item&&(input.defer!==true||item.studentId===null))await createHistoryRepository(database)(req.origenIdentity.sub,{action:'save',item,attribution});
 if(item&&input.defer===true&&item.studentId!==null&&attribution)await deferSummaryAttribution(database,req.origenIdentity.sub,item,attribution);
 if(execution){await createGuidanceRepository(database).finishExecution(req.origenIdentity.sub,execution,{status:'completed',durationMs:Date.now()-executionStarted,upstreamRequestId:response.headers?.get('x-request-id'),usage:data.usage,resolvedModel:data.model});completed=true;}
 return send(200,{summary:summary.slice(0,4000),item});
 }catch(error){if(![400,404,409].includes(error.status))req.log?.({event:'summary_error',level:'error',code:safeErrorCode(error)});const status=[400,404,409,503].includes(error.status)?error.status:502;return send(status,{error:status===502?'summary_unavailable':status===503?'history_unavailable':error.message});}finally{if(execution&&!completed)await createGuidanceRepository(database).finishExecution(req.origenIdentity.sub,execution,{status:'failed',durationMs:Date.now()-executionStarted,errorCode:'summary_unavailable'}).catch(()=>req.log?.({event:'guidance_error',code:'operation_failed'}));}
};}
