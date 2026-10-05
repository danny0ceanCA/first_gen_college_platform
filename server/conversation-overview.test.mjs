import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationOverview} from './conversation-overview.mjs';
import {createHistoryRepository} from './history.mjs';
import {fixture} from './family-fixture.mjs';

const memory=(id,summary,studentId=null)=>({id,studentId,summary,mode:'planning',date:`2026-10-0${id==='first'?1:2}T12:00:00Z`,sources:[]});
test('overview merges matching discussions once, preserves chronological corrections, and invalidates changed histories',async()=>{
 let calls=0;
 const overview=createConversationOverview({OPENAI_API_KEY:'test'},async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,'gpt-4.1-mini');
  const input=JSON.parse(body.input);
  if(input.length===1){assert.match(body.instructions,/faithfully in English/);return {ok:true,status:200,json:async()=>({output:[{content:[{type:'output_text',text:input[0].summary}]}]})};}
  assert.match(body.instructions,/ONE cohesive/);assert.match(body.instructions,/newer corrections/);
  assert.equal(input[0].summary,'Considering biology.');assert.equal(input[1].summary,'Now interested in engineering.');
  return {ok:true,status:200,json:async()=>({output:[{content:[{type:'output_text',text:'The family now plans to explore engineering, with course choices still unresolved.'}]}]})};
 },null);
 const input={studentId:null,language:'en',items:[memory('second','Now interested in engineering.'),memory('first','Considering biology.'),memory('other','Private student detail','someone')]};
 const result=await overview({},input);assert.match(result.summary,/engineering/);assert.equal(calls,1);
 await overview({},input);assert.equal(calls,1);
 const remaining=await overview({},{...input,items:[input.items[0]]});assert.equal(remaining.summary,input.items[0].summary);
 assert.equal((await overview({},{...input,items:[]})).summary,'');assert.equal(calls,2);
 await assert.rejects(overview({},{...input,studentId:undefined}),{status:400});
 await assert.rejects(overview({},{...input,items:[{...input.items[0],summary:'',sources:[]}]}),{status:400});
});

test('authenticated overview reads only owned saved records and clearing one scope cannot erase another',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{
  await run('one',{action:'save-account',account:{firstName:'Alex',email:''}});
  await run('one',{action:'save-student',student:{id:'student',name:'Sofia',stage:'10th grade'}});
  await history('one',{action:'save',item:memory('first','General family planning.')});
  await history('one',{action:'save',item:memory('second','Private student planning.','student')});
  await run('two',{action:'save-account',account:{firstName:'Other',email:''}});
  await history('two',{action:'save',item:memory('first','Other account only.')});
  const overview=createConversationOverview({OPENAI_API_KEY:'test'},async(_url,options)=>({ok:true,status:200,json:async()=>({output:[{content:[{type:'output_text',text:JSON.parse(JSON.parse(options.body).input)[0].summary}]}]})}),pool);
  const req={origenAuthorized:true,origenIdentity:{sub:'one'}};
  assert.equal((await overview(req,{studentId:null,language:'en',items:[memory('forged','Injected advice.')],subject:'two'})).summary,'General family planning.');
  await assert.rejects(overview(req,{studentId:'not-owned',language:'en'}),{status:404});
  await history('one',{action:'clear',studentId:null});
  assert.equal((await overview(req,{studentId:null,language:'en'})).summary,'');
  assert.equal((await history('one',{action:'load',studentId:'student'})).items.length,1);
  assert.equal((await history('two',{action:'load',studentId:null})).items.length,1);
 }finally{await pool.end();}
});

test('failed and incomplete overview generation is retryable and never cached as a successful summary',async()=>{
 let calls=0;
 const overview=createConversationOverview({OPENAI_API_KEY:'test'},async()=>({ok:true,status:200,json:async()=>++calls===1?{status:'incomplete',output:[]}:{status:'completed',output:[{content:[{type:'output_text',text:'Combined summary.'}]}]}}),null);
 const input={studentId:null,language:'es',items:[memory('first','One.'),memory('second','Two.')]};
 await assert.rejects(overview({},input),/incomplete_summary/);
 assert.equal((await overview({},input)).summary,'Combined summary.');assert.equal(calls,2);
});

test('single saved summaries translate with the selected language, cache each version, and preserve the original',async()=>{
 let calls=0;
 const english='The family will compare UC aid offers for fall 2027. A decision is still pending.';
 const spanish='La familia comparará las ofertas de ayuda de UC para el otoño de 2027. La decisión sigue pendiente.';
 const item=memory('first',english);
 const overview=createConversationOverview({OPENAI_API_KEY:'test'},async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);
  assert.match(body.instructions,/Do not expand, shorten, add advice/);
  assert.match(body.instructions,/Preserve meaning, decisions, uncertainty, dates/);
  assert.equal(JSON.parse(body.input)[0].summary,english);
  return {ok:true,status:200,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:body.instructions.includes('faithfully in Spanish')?spanish:english}]}]})};
 },null);
 const input={studentId:null,items:[item],language:'es'};
 assert.equal((await overview({},input)).summary,spanish);
 assert.equal((await overview({},input)).summary,spanish);assert.equal(calls,1);
 assert.equal((await overview({},{...input,language:'en'})).summary,english);assert.equal(calls,2);
 assert.equal((await overview({},input)).summary,spanish);assert.equal(calls,2);
 assert.equal(item.summary,english);
});
