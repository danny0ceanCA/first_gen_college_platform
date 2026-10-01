import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createFinanceResearchHandler,financeResearchRequest,parseFinanceResearch} from './finance-research.mjs';
const result=(url)=>({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified explanation.',annotations:[{type:'url_citation',url,title:'Official source',start_index:0,end_index:8}]}]}]});
async function call(handler,body,origin='http://127.0.0.1:5173'){
 const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/finance-research',method:'POST',headers:{host:'127.0.0.1:5173',origin,'content-type':'application/json'}});let status,data;
 await handler(req,{writeHead(s){status=s},end(s){data=JSON.parse(s)}},()=>assert.fail());return {status,data};
}
test('FSA searches restricted; school results require official citations and actual search',()=>{
 const config=financeResearchRequest({},{question:'What is FAFSA?',institution:'',language:'es'});
 assert.equal(config.model,'gpt-6.1-sol');
 assert.equal(financeResearchRequest({OPENAI_MODEL:'gpt-6-luna'},{question:'Costs',institution:'SDSU',language:'en'}).model,'gpt-6.1-sol');
 assert.equal(financeResearchRequest({OPENAI_MODEL_FINANCE_RESEARCH:'custom-research'},{question:'Aid',institution:'',language:'en'}).model,'custom-research');
 assert.deepEqual(config.tools[0].filters.allowed_domains,['studentaid.gov']);
 assert.equal(config.tool_choice,'required');assert.equal(config.max_tool_calls,undefined);
 assert.ok(parseFinanceResearch(result('https://studentaid.gov/help'),'')?.sources.length);
 assert.ok(parseFinanceResearch(result('https://financialaid.ucdavis.edu/cost'),'UC Davis'));
 assert.equal(parseFinanceResearch(result('https://college-costs.example/cost'),'UC Davis'),null);
 assert.equal(parseFinanceResearch(result('javascript:alert(1)'),'UC Davis'),null);
 assert.equal(parseFinanceResearch({output:[]},''),null);
});
test('research endpoint validates origin/input, returns citations, and permits repeated calls',async()=>{
 let count=0;
 const handler=createFinanceResearchHandler({OPENAI_API_KEY:'secret'},async(url,options)=>{
  count++;assert.equal(options.headers.Authorization,'Bearer secret');
  return new Response(JSON.stringify(result('https://studentaid.gov/help')));
 });
 const input={question:'Explain aid',institution:'',language:'en'};
 assert.equal((await call(handler,input,'https://bad.example')).status,403);
 assert.equal((await call(handler,{...input,question:''})).status,400);
 for(let i=0;i<5;i++)assert.equal((await call(handler,input)).status,200);
 assert.equal(count,5);
 const failed=createFinanceResearchHandler({OPENAI_API_KEY:'secret'},async()=>new Response('private error',{status:429}));
 assert.deepEqual((await call(failed,input)).data,{error:'research_unavailable'});
});
