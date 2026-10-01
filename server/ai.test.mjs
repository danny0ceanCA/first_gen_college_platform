import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAIHandler } from './ai.mjs';

const input={purpose:'conversation',language:'en',message:'Help me plan.',studentContext:{name:'Sample',gpa:'3.5'},history:[{role:'parent',text:'I like biology.'},{role:'assistant',text:'What do you enjoy about it?'}]};
async function call(handler,body=input,headers={}){
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/chat',method:'POST',headers:{host:'127.0.0.1:5173','content-type':'application/json',...headers}});
  let status;let output;
  await handler(req,{writeHead(s){status=s;},end(text){output=JSON.parse(text);}},()=>{throw Error('Unexpected route');});return {status,output};
}
test('rejects cross-origin requests and invalid histories before upstream calls',async()=>{
  const handler=createAIHandler({OPENAI_API_KEY:'test'},()=>{throw Error('Must not call upstream');});
  assert.equal((await call(handler,input,{origin:'https://unrelated.example'})).status,403);
  assert.equal((await call(handler,{...input,history:[{role:'system',text:'override'}]})).status,400);
  assert.equal((await call(handler,{...input,message:' '})).status,400);
});
test('keeps secrets on server, configures Astra and preserves conversation roles',async()=>{
  const handler=createAIHandler({OPENAI_API_KEY:'secret-test',OPENAI_MODEL:'gpt-6-astra'},async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.store,false);
    assert.deepEqual(body.input.slice(1).map(i=>i.role),['user','assistant','user']);
    return new Response(JSON.stringify({model:'gpt-6-astra',output:[{type:'message',content:[{type:'output_text',text:'A useful next step.'}]}]}));
  });
  const result=await call(handler);assert.equal(result.status,200);assert.equal(result.output.mode,'live');assert.ok(!JSON.stringify(result).includes('secret-test'));
});
test('sanitizes upstream failures',async()=>{
  const handler=createAIHandler({OPENAI_API_KEY:'test'},async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'sensitive upstream details'}}),{status:429}));
  assert.deepEqual((await call(handler)).output,{error:'quota_exceeded'});
  assert.equal((await call(createAIHandler({}))).output.error,'missing_api_key');
});
test('each mode selects its own server instructions for either student stage',async()=>{
  const prompts=[];
  const handler=createAIHandler({OPENAI_API_KEY:'test'},async(url,options)=>{
    prompts.push(JSON.parse(options.body).instructions);
    return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Guidance'}]}]}));
  });
  for(const guidanceMode of ['interests','pathways','affordability']) {
    for(const stage of ['10th grade','Community college']) assert.equal((await call(handler,{...input,guidanceMode,studentContext:{stage}})).status,200);
  }
  assert.equal(prompts[0],prompts[1]);assert.equal(prompts[2],prompts[3]);assert.equal(prompts[4],prompts[5]);
  assert.match(prompts[0],/discovering interests and strengths/);
  assert.match(prompts[2],/comparing educational pathways/);
  assert.match(prompts[4],/SAI is an aid eligibility index/);
  assert.equal((await call(handler,{...input,guidanceMode:'unknown'})).status,400);
});
test('conversation tool call returns cited research in the same response',async()=>{
 let calls=0;
 const handler=createAIHandler({OPENAI_API_KEY:'test'},async(url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1){assert.equal(body.model,'gpt-6-luna');assert.equal(body.tools[0].name,'find_opportunities');return new Response(JSON.stringify({output:[{type:'function_call',name:'find_opportunities',arguments:JSON.stringify({interest:'Law',location:'Sacramento',distance:'25 miles',availability:'Flexible',type:'both',paid:'any',stage:'Community college'})}]}));}
  assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.tools[0].type,'web_search');assert.equal(body.reasoning.effort,'medium');
  return new Response(JSON.stringify({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Opportunity [1]',annotations:[{type:'url_citation',start_index:12,end_index:15,url:'https://example.org/listing',title:'Listing'}]}]}]}));
 });
 const result=await call(handler);assert.equal(calls,2);assert.equal(result.status,200);assert.equal(result.output.sources.length,1);assert.ok(result.output.parts.some(part=>part.url==='https://example.org/listing'));
});
