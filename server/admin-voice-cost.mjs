// Standard USD list prices checked 2026-10-28. Estimates, not invoice amounts.
// Sources: developers.openai.com/api/docs/models/{gpt-live-1,gpt-realtime-2.1,gpt-6-luna,gpt-4o-mini-transcribe}
export const rateCard={version:'2026-10-28',liveMinute:0.05,realtime:{text:4,audio:32,cached:0.4,textOutput:24,audioOutput:64},backend:{model:'gpt-6-luna',input:0.1,cached:0.01,write:0.125,output:0.5},transcription:{input:1.25,output:5}};
const count=n=>Number.isFinite(n)&&n>=0?n:0;
export function tokenCost(model,usage){
 if(!usage||!Number.isFinite(usage.input_tokens)||usage.input_tokens<0||!Number.isFinite(usage.output_tokens)||usage.output_tokens<0)return null;
 const i=usage.input_token_details||usage.input_tokens_details||{},o=usage.output_token_details||{},input=count(usage.input_tokens),output=count(usage.output_tokens),cached=Math.min(input,count(i.cached_tokens));
 if(model==='gpt-realtime-2.1'){
  if(!Number.isFinite(i.audio_tokens)||!Number.isFinite(i.text_tokens)||!Number.isFinite(o.audio_tokens)||!Number.isFinite(o.text_tokens))return null;
  const details=i.cached_tokens_details||{},ca=count(details.audio_tokens),ct=count(details.text_tokens);
  if(cached&&ca+ct!==cached||ca>i.audio_tokens||ct>i.text_tokens||i.audio_tokens<0||i.text_tokens<0||o.audio_tokens<0||o.text_tokens<0||i.audio_tokens+i.text_tokens!==input||o.audio_tokens+o.text_tokens>output)return null;
  // Unclassified output tokens include reasoning; use the text output rate.
  return ((i.audio_tokens-ca)*32+(i.text_tokens-ct)*4+cached*.4+o.audio_tokens*64+(output-o.audio_tokens)*24)/1e6;
 }
 if(model===rateCard.backend.model||model?.startsWith(rateCard.backend.model+'-')){
  const writes=Math.min(input-cached,count(i.cache_write_tokens));
  return ((input-cached-writes)*.1+cached*.01+writes*.125+output*.5)/1e6;
 }
 if(model==='gpt-4o-mini-transcribe')return(input*1.25+output*5)/1e6;
 return null;
}
export function createCostLedger(model){
 const responses=new Map(),transcriptions=new Map(),pending=new Set(),pendingTranscriptions=new Set();let seconds=0,final=false,unknown=false,speaking=false;
 return {
  ingest(envelope){
   const e=envelope.type==='response.event'?envelope.event:envelope;
   if(['session.usage.updated','session.closed'].includes(e.type)&&Number.isFinite(e.usage?.seconds))seconds=Math.max(seconds,e.usage.seconds);
   if(e.type==='session.closed')final=Number.isFinite(e.usage?.seconds);
   if(e.type==='response.created'&&e.response?.id)pending.add(e.response.id);
   if(['response.done','response.completed','response.failed','response.incomplete','response.cancelled'].includes(e.type)&&e.response?.id){
    pending.delete(e.response.id);const kind=envelope.type==='response.event'?'backend':'voice';
    const resolved=e.response.model||(kind==='backend'?rateCard.backend.model:model);
    responses.set(e.response.id,{kind,model:resolved,usage:e.response.usage,cost:tokenCost(resolved,e.response.usage)});
   }
   if(e.type==='input_audio_buffer.speech_started')speaking=true;
   if(e.type==='input_audio_buffer.committed'&&model!=='gpt-live-1'){speaking=false;pendingTranscriptions.add(e.item_id);}
   if(e.type==='conversation.item.input_audio_transcription.completed'&&e.item_id){pendingTranscriptions.delete(e.item_id);transcriptions.set(e.item_id,{usage:e.usage,cost:tokenCost('gpt-4o-mini-transcribe',e.usage)});}
   if(e.type==='conversation.item.input_audio_transcription.failed'){pendingTranscriptions.delete(e.item_id);unknown=true;}
  },
  response(response,kind='draft'){responses.set(response.id,{kind,model:response.model,usage:response.usage,cost:tokenCost(response.model,response.usage)});},
  missing(){unknown=true;},
  pending(){return !!(speaking||pending.size||pendingTranscriptions.size);},
  snapshot(closed=false,created=true){
   const totals={voice:model==='gpt-live-1'&&created?Math.max(15,seconds)/60*.05:0,backend:0,draft:0,transcription:0,tools:0};
   let complete=closed&&!unknown&&!pending.size&&!pendingTranscriptions.size&&(!speaking||model==='gpt-live-1')&&(model!=='gpt-live-1'||final);
   for(const entry of responses.values()){if(entry.cost===null)complete=false;else totals[entry.kind]+=entry.cost;}
   for(const entry of transcriptions.values()){if(entry.cost===null)complete=false;else totals.transcription+=entry.cost;}
   return {rateCard,seconds,totals,total:Object.values(totals).reduce((a,b)=>a+b,0),complete,usage:[...responses.entries()].map(([id,e])=>({id,...e})),transcriptions:transcriptions.size};
  }
 };
}
