import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {admissionsResearchRequest,parseAdmissionsResearch,createAdmissionsResearchHandler} from './admissions-research.mjs';
const result=url=>({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified instructions.',annotations:[{type:'url_citation',url,title:'Official instructions',start_index:0,end_index:8}]}]}]});
async function call(handler,body,origin='http://127.0.0.1:5173'){
 const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/admissions-research',method:'POST',headers:{host:'127.0.0.1:5173',origin,'content-type':'application/json','x-origen-session':'test-session'}});let status,data;
 await handler(req,{writeHead(s){status=s;},end(s){data=JSON.parse(s);}},()=>assert.fail());return {status,data};
}
test('admissions uses Sol and requires completed search with official citations',()=>{
 const input={question:'UC transfer application requirements for Fall 2027',institution:'UC',language:'es'};
 const request=admissionsResearchRequest({OPENAI_MODEL:'gpt-6-luna'},input);
 assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.reasoning.effort,'low');assert.equal(request.max_output_tokens,1800);assert.match(request.instructions,/only the specific question/);assert.equal(request.tool_choice,'required');assert.equal(request.store,false);
 assert.match(request.instructions,/Spanish/);assert.match(request.instructions,/exact application cycle/);
 assert.equal(admissionsResearchRequest({OPENAI_MODEL_ADMISSIONS_RESEARCH:'research-override'},input).model,'research-override');
 for(const url of ['https://admission.universityofcalifornia.edu/apply','https://www.calstate.edu/apply','https://www.commonapp.org/apply','https://commonapp.my.site.com/help','https://www.cccapply.org/apply','https://admissions.sdsu.edu/apply'])assert.ok(parseAdmissionsResearch(result(url),'')?.sources.length);
 for(const url of ['https://commonapp.org.evil.example/apply','https://fakecommonapp.org/apply','http://www.commonapp.org/apply','https://college-blog.example/apply'])assert.equal(parseAdmissionsResearch(result(url),''),null);
 assert.equal(parseAdmissionsResearch({output:[]},''),null);
 assert.equal(parseAdmissionsResearch({...result('https://www.commonapp.org/apply'),status:'incomplete'},''),null);
});
test('admissions endpoint rejects invalid requests, returns sources and logs no question',async()=>{
 const logs=[];let count=0;
 const handler=createAdmissionsResearchHandler({OPENAI_API_KEY:'secret'},async(url,options)=>{
  count++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(options.body).model,'gpt-6.1-sol');
  return new Response(JSON.stringify(result('https://www.calstate.edu/apply')));
 },event=>logs.push(event));
 const input={question:'Cal State Apply course entry',institution:'CSU',language:'en'};
 assert.equal((await call(handler,input,'https://other.example')).status,403);
 assert.equal((await call(handler,{...input,question:''})).status,400);
 const response=await call(handler,input);assert.equal(response.status,200);assert.equal(response.data.sources.length,1);assert.equal(count,1);
 assert.ok(logs.some(e=>e.sessionId==='test-session'&&e.event==='admissions_lookup'));
 assert.ok(!JSON.stringify(logs).includes(input.question));
 const failed=createAdmissionsResearchHandler({OPENAI_API_KEY:'secret'},async()=>new Response('private upstream details',{status:500}));
 assert.deepEqual((await call(failed,input)).data,{error:'research_unavailable'});
});

test('ASSIST citations are accepted only on official HTTPS domains with exact-agreement guidance',()=>{
 for(const url of ['https://assist.org/','https://www.assist.org/','https://resource.assist.org/FAQ'])assert.ok(parseAdmissionsResearch(result(url),'')?.sources.length);
 for(const url of ['https://assist.org.evil.example/','https://fakeassist.org/','http://assist.org/'])assert.equal(parseAdmissionsResearch(result(url),''),null);
 const request=admissionsResearchRequest({}, {question:'Which courses transfer?',institution:'UC Davis',language:'en'});
 assert.match(request.instructions,/sending community college, receiving campus, major and academic year/);
 assert.match(request.instructions,/A general ASSIST help page cannot verify a specific course equivalency/);
 assert.match(request.instructions,/never invent course matches/);
});
