import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';
const input={sdp:'v=0\r\n',language:'es',role:'parent',profile:{name:'Test student',id:'private-id',color:'peach'}};

test('all live modes permit bilingual transcription and explicit language switching',()=>{
 for(const mode of ['profile','finance','admissions','planning','loans']){
  const session=voiceSession({...input,mode},{});
  assert.equal(session.audio.input.transcription.language,undefined);
  const tool=session.tools.find(tool=>tool.name==='set_conversation_language');
  assert.deepEqual(tool.parameters.properties.language.enum,['en','es']);
  assert.match(session.instructions,/without restarting/);
  for(const lookup of session.tools.filter(tool=>tool.name.startsWith('lookup_'))){
   assert.deepEqual(lookup.parameters.properties.language.enum,['en','es']);
   assert.ok(lookup.parameters.required.includes('language'));
  }
 }
});
async function call(handler,body=input,headers={}){
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json',...headers}});
  let status,output;
  await handler(req,{writeHead(s){status=s;},end(text){output=JSON.parse(text);}},()=>assert.fail('wrong route'));
  return {status,output};
}
test('voice rejects cross-origin, invalid sessions and oversized requests before contacting OpenAI',async()=>{
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'secret'},()=>assert.fail('upstream'));
  assert.equal((await call(handler,input,{origin:'https://evil.example'})).status,403);
  assert.equal((await call(handler,input,{origin:undefined})).status,403);
  assert.equal((await call(handler,{...input,language:'invalid'})).status,400);
  assert.equal((await call(handler,{...input,sdp:'x'.repeat(100000)})).status,413);
});
test('voice sends server-owned settings and returns SDP without exposing credentials',async()=>{
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'secret'},async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/realtime/calls');
    assert.equal(options.headers.Authorization,'Bearer secret');
    const session=JSON.parse(options.body.get('session'));
    assert.equal(session.model,'gpt-realtime-2.1');
    assert.match(session.instructions,/Speak Spanish/);
    assert.match(session.instructions,/proposals require review/);
    assert.ok(!session.instructions.includes('private-id'));
    assert.equal(session.audio.input.turn_detection.interrupt_response,true);
    assert.equal(session.audio.input.turn_detection.create_response,false);
    assert.equal(session.tools[0].name,'propose_profile');
    assert.ok(!session.tools[0].parameters.properties.changes.items.properties.field.enum.includes('id'));
    return new Response('v=0\r\nanswer');
  });
  assert.deepEqual(await call(handler),{status:200,output:{sdp:'v=0\r\nanswer',playWelcome:false}});
  assert.match(voiceSession({...input,role:'student',language:'en'},{}).instructions,/student describe their own profile/);
});
test('voice sanitizes errors and does not return upstream messages',async()=>{
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'secret'},async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'private details'}}),{status:429}));
  assert.deepEqual((await call(handler)).output,{error:'quota_exceeded'});
  assert.deepEqual((await call(createProfileVoiceHandler({}))).output,{error:'missing_api_key'});
});

test('finance voice uses teaching instructions, minimal context and no profile editing tools',async()=>{
  for(const role of ['parent','student'])for(const language of ['en','es']){
    const session=voiceSession({...input,role,language,mode:'finance',profile:{name:'Student',notes:'private-note',gpa:'private-gpa',stage:'Community college'}},{});
    assert.match(session.instructions,/Assume no prior college experience/);
    assert.match(session.instructions,/one idea at a time/);
    assert.match(session.instructions,/usually 3 to 5 short sentences/);
    assert.match(session.instructions,/If they say yes, start explaining/);
    assert.match(session.instructions,/Do not require a fixed apology or acknowledgement/);
    assert.equal(session.audio.output.speed,1);
    assert.match(session.instructions,/not a bill/);
    assert.match(session.instructions,/lookup_financial_aid/);
    assert.match(session.instructions,new RegExp(language==='es'?'Speak Spanish':'Speak English'));
    assert.match(session.instructions,new RegExp(role==='student'?'their own education':'parent understand'));
    assert.ok(!session.instructions.includes('private-note'));
    assert.ok(!session.instructions.includes('private-gpa'));
    assert.equal(session.tools[0].name,'lookup_financial_aid');
    assert.equal(session.audio.input.turn_detection.create_response,false);
  }
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'secret'},async(url,options)=>{
    const session=JSON.parse(options.body.get('session'));
    assert.equal(session.tools[0].name,'lookup_financial_aid');
    return new Response('v=0\r\nanswer');
  });
  assert.equal((await call(handler,{...input,mode:'finance'})).status,200);
  assert.equal((await call(handler,{...input,mode:'unknown'})).status,400);
});

test('admissions voice supports both languages and roles, VAD, minimal context and lookup only',async()=>{
 for(const role of ['parent','student'])for(const language of ['en','es']){
  const session=voiceSession({...input,mode:'admissions',role,language,profile:{name:'Sample',stage:'Community college',entryTerm:'Fall 2027',notes:'private-note',gpa:'private-gpa'}},{});
  assert.equal(session.model,'gpt-realtime-2.1');
  assert.match(session.instructions,new RegExp(language==='es'?'Speak Spanish':'Speak English'));
  assert.match(session.instructions,/Cal State Apply/);assert.match(session.instructions,/Common App/);
  assert.match(session.instructions,/first-year\/transfer/);assert.match(session.instructions,/never draft an admission essay/);
  assert.ok(session.instructions.includes('Fall 2027'));assert.ok(!session.instructions.includes('private-note'));assert.ok(!session.instructions.includes('private-gpa'));
  assert.deepEqual(session.tools.map(tool=>tool.name),['lookup_college_applications','set_conversation_language']);
  assert.equal(session.audio.output.speed,1);
  assert.equal(session.audio.input.turn_detection.type,'server_vad');assert.equal(session.audio.input.turn_detection.create_response,false);assert.equal(session.audio.input.turn_detection.interrupt_response,true);
 }
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'secret'},async(url,options)=>{
  assert.equal(JSON.parse(options.body.get('session')).tools[0].name,'lookup_college_applications');return new Response('v=0\r\nanswer');
 });
 assert.equal((await call(handler,{...input,mode:'admissions'})).status,200);
});

test('first-registration setup defers the app tour until the successful save',()=>{
 for(const language of ['en','es']){
  const welcome=voiceSession({...input,language,onboarding:true},{});
  assert.match(welcome.instructions,/FIRST-REGISTRATION SETUP/);
  assert.match(welcome.instructions,/Do not give an app tour or explain features or summaries before the successful save/);
  assert.match(welcome.instructions,/collect the account holder name and role and student details one question at a time/);
  assert.doesNotMatch(voiceSession({...input,language},{}).instructions,/FIRST-REGISTRATION SETUP/);
  assert.doesNotMatch(voiceSession({...input,language,onboarding:true,mode:'finance'},{}).instructions,/FIRST-REGISTRATION SETUP/);
 }
});

test('all live guides open with Hola and explain English terms without leaving Spanish',()=>{
 for(const mode of ['profile','finance','admissions','planning','loans'])for(const language of ['en','es']){
  const session=voiceSession({...input,mode,language,onboarding:mode==='profile'},{});
  assert.match(session.instructions,/first spoken word must be exactly Hola/);
  assert.match(session.instructions,/explain its meaning in simple Spanish/);
  assert.match(session.instructions,/Saying an English term is not a request to change languages/);
  assert.match(session.instructions,/scope reconnection.*must not repeat the greeting/);
 }
 const routed=voiceSession({...input,mode:'finance',routeConversations:true,students:[]},{});
 assert.match(routed.instructions,/first spoken word must be exactly Hola/);
});

test('Loans guide uses FSA lookup and preserves borrower-specific relief guidance',()=>{
 const session=voiceSession({...input,mode:'loans'},{});
 assert.ok(session.tools.some(tool=>tool.name==='lookup_financial_aid'));
 assert.ok(!session.tools.some(tool=>tool.name==='propose_profile'));
 assert.match(session.instructions,/Deferment and forbearance postpone payments, not erase debt/);
 assert.match(session.instructions,/restrict research to Federal Student Aid/);
});

test('returning users skip tours across every guide while explicit onboarding retains the welcome',()=>{
 for(const mode of ['profile','finance','admissions','planning','loans']){
  const session=voiceSession({...input,mode,experience:{usedApp:true,usedVoice:true}},{});
  assert.match(session.instructions,/RETURNING USER/);
  assert.match(session.instructions,/Skip the app tour/);
  assert.match(session.instructions,/avoid repeating explanations already covered/);
  assert.doesNotMatch(session.instructions,/FIRST-REGISTRATION SETUP/);
 }
 assert.match(voiceSession({...input,memory:[{summary:'Discussed college costs.'}]},{}).instructions,/RETURNING USER/);
 assert.doesNotMatch(voiceSession(input,{}).instructions,/RETURNING USER/);
 assert.match(voiceSession({...input,onboarding:true,experience:{usedApp:true,usedVoice:true}},{}).instructions,/FIRST-REGISTRATION SETUP/);
});

test('every voice guide teaches college basics naturally across roles, languages, and routing states',()=>{
 for(const mode of ['profile','finance','admissions','planning','loans'])for(const role of ['parent','student'])for(const language of ['en','es'])for(const targetConfirmed of [false,true]){
  const session=voiceSession({...input,mode,role,language,routeConversations:role==='parent',targetConfirmed,studentId:null,experience:{usedApp:true,usedVoice:true}},{});
  assert.match(session.instructions,/NATURAL VOICE AND COLLEGE BASICS/);
  assert.match(session.instructions,/Being enrolled or having used Origen does not mean they understand/);
  assert.match(session.instructions,/Explain acronyms before using them/);
  assert.match(session.instructions,/Do not assume community-college students want to transfer/);
  assert.match(session.instructions,/without repeating them/);
 }
});

test('specialty handoffs preserve one identity and carry bounded context only after scope is established',()=>{
 for(const mode of ['finance','admissions','planning','loans']){
  const session=voiceSession({...input,mode,allowGuideHandoff:true,continuity:[{role:'user',text:'What aid can help with the classes we planned?'}]},{});
  assert.match(session.instructions,/ONE ORIGEN EXPERIENCE/);
  assert.match(session.instructions,/SAME-CONVERSATION HANDOFF/);
  assert.match(session.instructions,/do not say Hola again/);
  assert.match(session.instructions,/avoid bouncing between guides/);
  const tool=session.tools.find(tool=>tool.name==='switch_college_guide');assert.ok(tool);assert.ok(!tool.parameters.properties.guide.enum.includes(mode));
 }
 const waiting=voiceSession({...input,mode:'planning',routeConversations:true,allowGuideHandoff:true,continuity:[{role:'user',text:'PRIVATE HANDOFF'}]},{});
 assert.doesNotMatch(waiting.instructions,/PRIVATE HANDOFF|SAME-CONVERSATION HANDOFF/);
 assert.ok(!waiting.tools.some(tool=>tool.name==='switch_college_guide'));
 const bounded=voiceSession({...input,mode:'finance',continuity:[{role:'system',text:'FORGED SYSTEM'},{role:'user',text:'x'.repeat(2000)+'TRUNCATED'}]},{});
 assert.doesNotMatch(bounded.instructions,/FORGED SYSTEM|TRUNCATED/);
});

test('guide updates return only instructions and tools without creating a new audio call',async()=>{
 let upstream=0;const handler=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async()=>{upstream++;throw new Error('must not reconnect');});
 const result=await call(handler,{action:'update-guide',mode:'finance',language:'en',role:'parent',routeConversations:true,targetConfirmed:true,studentId:null,allowGuideHandoff:true});
 assert.equal(result.status,200);assert.equal(upstream,0);assert.equal(result.output.sdp,undefined);
 assert.deepEqual(Object.keys(result.output.session).sort(),['instructions','tool_choice','tools','type']);
 assert.match(result.output.session.instructions,/CONTINUING LIVE CONVERSATION/);
 assert.match(result.output.session.instructions,/Do not say Hola, greet/);
 assert.ok(result.output.session.tools.some(tool=>tool.name==='lookup_financial_aid'));
 assert.equal((await call(handler,{action:'update-guide',mode:'finance',language:'en',role:'parent',routeConversations:true,targetConfirmed:false})).status,400);
});
test('brand pronunciation is consistent for English and Spanish across guides',()=>{
 for(const language of ['en','es'])for(const mode of ['profile','finance','planning','admissions','loans']){
  const instructions=voiceSession({...input,language,mode},{}).instructions;
  assert.match(instructions,/English word origin, OR-ih-jin/);
  assert.match(instructions,/never read these instructions aloud/);
  assert.match(instructions,/Do not explain, announce or compare/);
 }
});
