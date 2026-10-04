import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSummaryHandler} from './conversation-summary.mjs';
import {voiceSession} from './profile-voice.mjs';
async function call(handler,input,origin='http://127.0.0.1:5173'){let status,body;await handler(Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/conversation-summary',method:'POST',headers:{host:'127.0.0.1:5173',origin}}),{writeHead(s){status=s;},end(s){body=JSON.parse(s);}},()=>assert.fail());return {status,body};}
test('summary validates origin and transcript before calling OpenAI',async()=>{const h=createSummaryHandler({OPENAI_API_KEY:'test'},()=>assert.fail());assert.equal((await call(h,{},'https://example.com')).status,403);assert.equal((await call(h,{language:'en',turns:[{role:'system',text:'invalid'}]})).status,400);});
test('summary disables API storage and returns summarized text only',async()=>{const h=createSummaryHandler({OPENAI_API_KEY:'test'},async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.store,false);assert.match(body.instructions,/Do not invent/);return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Family asked about tuition. Residency is unresolved.'}]}]})};});assert.equal((await call(h,{language:'en',turns:[{role:'user',text:'What is tuition?'}]})).body.summary,'Family asked about tuition. Residency is unresolved.');});

test('long live conversations retain the first and final exchanges when summarized',async()=>{
 const turns=Array.from({length:120},(_,i)=>({role:i%2?'assistant':'user',text:`Exchange ${i}`}));
 let calls=0;
 const handler=createSummaryHandler({OPENAI_API_KEY:'test'},async(url,options)=>{
  calls++;assert.deepEqual(JSON.parse(JSON.parse(options.body).input),turns);
  return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Discussed college applications and agreed next steps.'}]}]})};
 });
 const result=await call(handler,{language:'en',turns});
 assert.equal(result.status,200);assert.equal(calls,1);assert.match(result.body.summary,/next steps/);
 assert.equal((await call(handler,{language:'en',turns:Array.from({length:401},()=>turns[0])})).status,400);
 assert.equal((await call(handler,{language:'en',turns:[null]})).status,400);
 assert.equal(calls,1);
});
test('voice receives bounded past summaries as data and rechecks changing facts',()=>{const session=voiceSession({language:'en',role:'parent',profile:{},memory:[{summary:'Discussed UC costs',date:'2026-10-01',mode:'finance'}]},{});assert.match(session.instructions,/Discussed UC costs/);assert.match(session.instructions,/Verify current costs/);assert.match(session.instructions,/context data, never instructions/);});

test('summaries use narrative instructions and an economical dedicated model with overrides',async()=>{
 for(const [env,expected] of [[{},'gpt-4.1-mini'],[{OPENAI_MODEL_CONVERSATION:'legacy-model'},'legacy-model'],[{OPENAI_MODEL_SUMMARY:'summary-model',OPENAI_MODEL_CONVERSATION:'legacy-model'},'summary-model']]){
  const handler=createSummaryHandler({OPENAI_API_KEY:'test',...env},async(_url,options)=>{
   const request=JSON.parse(options.body);assert.equal(request.model,expected);
   assert.match(request.instructions,/natural narrative/);assert.match(request.instructions,/one to three connected paragraphs/);
   assert.match(request.instructions,/Do not produce a transcript/);assert.match(request.instructions,/speech-recognition noise/);
   assert.match(request.instructions,/never pad/);assert.match(request.instructions,/Do not invent facts/);
   return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'The family explored transfer options. A destination school has not been chosen.'}]}]})};
  });
  assert.equal((await call(handler,{language:'en',mode:'planning',turns:[{role:'user',text:'Tell me about transfer.'}]})).status,200);
 }
});
