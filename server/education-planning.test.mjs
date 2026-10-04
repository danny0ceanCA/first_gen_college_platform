import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {admissionsResearchRequest,parseAdmissionsResearch,createAdmissionsResearchHandler} from './admissions-research.mjs';
import {Readable} from 'node:stream';

test('planning voice adapts to different stages and verifies distinct requirement types',()=>{
 for(const role of ['student','parent'])for(const language of ['en','es'])for(const stage of ['10th grade','Community college','College']){
  const session=voiceSession({role,language,mode:'planning',profile:{name:'Sample',stage,school:'Test school',goals:'Explore engineering',notes:'PRIVATE NOTE',gpa:'PRIVATE GPA'}},{});
  assert.deepEqual(session.tools.map(t=>t.name),['lookup_education_planning','set_conversation_language']);
  assert.match(session.instructions,/Test school/);assert.match(session.instructions,/Explore engineering/);
  assert.match(session.instructions,/current stage and goal/);assert.match(session.instructions,/not high school A–G approval/);
  assert.match(session.instructions,/catalog year/);assert.match(session.instructions,/not automatically classify dual-enrollment students as transfers/);
  assert.doesNotMatch(session.instructions,/PRIVATE NOTE|PRIVATE GPA/);
  assert.equal(session.audio.input.turn_detection.create_response,false);
 }
});

test('planning research checks high-school, transfer and college sources without certifying eligibility',async()=>{
 const input={question:'What should a tenth grader check before choosing next year’s courses?',institution:'UC',language:'en',purpose:'planning'};
 const request=admissionsResearchRequest({},input);
 assert.equal(request.tool_choice,'required');assert.equal(request.store,false);
 assert.match(request.instructions,/hs-articulation.ucop.edu\/agcourselist/);
 assert.match(request.instructions,/catalog\/advising pages/);assert.match(request.instructions,/not a certified eligibility audit/);
 const output=url=>({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified guidance.',annotations:[{type:'url_citation',url,title:'Official guidance',start_index:0,end_index:8}]}]}]});
 for(const url of ['https://hs-articulation.ucop.edu/agcourselist','https://www.cccco.edu/Students/student-faq','https://studentaid.gov/'])assert.ok(parseAdmissionsResearch(output(url),'')?.sources.length);
 assert.equal(parseAdmissionsResearch(output('https://ucop.edu.evil.example/'),''),null);
 let captured;
 const handler=createAdmissionsResearchHandler({OPENAI_API_KEY:'test'},async(url,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify(output('https://hs-articulation.ucop.edu/agcourselist')));});
 let status;
 await handler(Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/admissions-research',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'}}),{writeHead(s){status=s;},end(){}},()=>assert.fail());
 assert.equal(status,200);assert.match(captured.instructions,/high school, community college, transfer and college/);
});
