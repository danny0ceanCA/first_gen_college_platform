import test from 'node:test';
import assert from 'node:assert/strict';
import {processResearchJob} from './voice-research-worker.mjs';
const evidence=url=>({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified explanation.',annotations:[{type:'url_citation',url,title:'Official source',start_index:0,end_index:8}]}]}]});
function fixture(input){let available=true;const writes=[];return {writes,async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:'job',input}]};}writes.push({sql,args});return {rows:[{status:'running'}]};}};}
for(const language of ['en','es'])test(`worker verifies official citations and minimizes provider input (${language})`,async()=>{
 const db=fixture({question:'Cost of attendance',institution:'UC Davis',language,mode:'finance'});
 await processResearchJob(db,{OPENAI_API_KEY:'fake'},{request:async(url,options)=>{const b=JSON.parse(options.body);assert.equal(b.max_tool_calls,2);assert.equal(b.store,false);assert.ok(!options.body.includes('auth0'));return new Response(JSON.stringify(evidence('https://financialaid.ucdavis.edu/cost')));}});
 assert.ok(db.writes.some(w=>w.sql.includes("status='completed'")&&w.args[1].sources.length));
 assert.equal(await processResearchJob(db,{}, {request:()=>assert.fail('empty queue must not incur cost')}),false);
});
test('unofficial evidence fails closed and is not retried',async()=>{
 const db=fixture({question:'Cost',institution:'UC Davis',language:'en',mode:'finance'});
 await processResearchJob(db,{}, {request:async()=>new Response(JSON.stringify(evidence('https://fake.example/fees')))});
 assert.ok(!db.writes.some(w=>w.sql.includes("status='completed'")));assert.ok(db.writes.some(w=>w.sql.includes("status='failed'")));
});
test('shutdown signal propagates to the provider; completed writes guard cancellation',async()=>{
 const db=fixture({question:'Cost',institution:'UC Davis',language:'en',mode:'finance'}),controller=new AbortController();
 await processResearchJob(db,{}, {signal:controller.signal,request:async(url,options)=>{controller.abort();assert.equal(options.signal.aborted,true);throw Error('aborted');}});
 assert.ok(db.writes.at(-1).sql.includes("AND status='running'"));
});
