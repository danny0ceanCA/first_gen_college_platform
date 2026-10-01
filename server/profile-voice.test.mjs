import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';
const input={sdp:'v=0\r\n',language:'es',role:'parent',profile:{name:'Test student',id:'private-id',color:'peach'}};
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
  assert.deepEqual(await call(handler),{status:200,output:{sdp:'v=0\r\nanswer'}});
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
    assert.match(session.instructions,/I gave you too much at once/);
    assert.equal(session.audio.output.speed,0.95);
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
