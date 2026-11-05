import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';import {studentLiveSession,studentLiveInstructions,negotiateStudentLive,studentVoiceModel} from './student-live-session.mjs';
const teaching={id:'published-teaching',revision:14,content:{topic:'admissions',title:'Student background',deliveryStyle:'Warm, patient and encouraging.',conversationApproach:'Acknowledge uncertainty, then offer concrete choices.',example:'Your experiences are worth exploring.'}};
for(const language of ['en','es'])for(const mode of ['profile','planning','admissions','finance','loans'])test(`Live retains ${language} ${mode} backend instructions and tool contracts`,()=>{
 const input={language,mode,onboarding:mode==='profile',role:'student',saveOnboarding:true,profile:{name:'Synthetic student',stage:'Community college'}};
 const legacy=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'}),live=studentLiveSession(legacy,input,[teaching]);
 assert.equal(live.model,'gpt-live-1');assert.equal(live.store,false);assert.equal(live.delegation.responses.instructions,legacy.instructions);
 assert.deepEqual(live.delegation.responses.reasoning,{effort:'low'});
 assert.deepEqual(live.delegation.responses.tools.map(({strict,...tool})=>tool),legacy.tools);assert.ok(live.delegation.responses.tools.every(tool=>tool.strict===false));
 assert.match(live.instructions,/Origen/);assert.match(live.instructions,/Warm, patient and encouraging/);assert.match(live.instructions,/Acknowledge uncertainty/);
 if(input.onboarding)assert.match(live.instructions,/This call is onboarding/);
 assert.equal(live.audio.input,undefined);assert.equal(live.type,undefined);assert.equal(live.delegation.type,'responses');
});
test('Live negotiation uses the documented WebRTC transport and preserves error responses',async()=>{
 let sent;const result=await negotiateStudentLive(async(url,options)=>{sent={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({session:{id:'session-test'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});},'synthetic',{instructions:'Authorized scope',tools:[],tool_choice:'auto'},{sdp:'v=0\r\noffer',language:'en'});
 assert.equal(sent.url,'https://api.openai.com/v1/live/sessions');assert.deepEqual(sent.body.transport,{type:'webrtc',sdp:'v=0\r\noffer'});assert.equal(result.sdp,'v=0\r\nanswer');assert.equal(result.providerId,'session-test');
 const failure=await negotiateStudentLive(async()=>new Response('{"error":{"code":"model_not_found"}}',{status:404}),'synthetic',{instructions:'',tools:[]},{sdp:'v=0',language:'es'});assert.equal(failure.response.status,404);assert.equal((await failure.response.json()).error.code,'model_not_found');
});

test('New student clients default to Live; older tabs and explicit rollback retain Realtime',async()=>{
 assert.equal(studentVoiceModel({voiceProtocol:'live-v1'}),'gpt-live-1');assert.equal(studentVoiceModel({}),'gpt-realtime-2.1');assert.equal(studentVoiceModel({voiceProtocol:'live-v1'},{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'}),'gpt-realtime-2.1');
 let calls=0;const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic'},async(url,options)=>{calls++;assert.ok(url.endsWith('/live/sessions'));assert.equal(JSON.parse(options.body).session.model,'gpt-live-1');return new Response(JSON.stringify({session:{id:'isolated'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});});
 let status,data;const input={sdp:'v=0\r\noffer',voiceProtocol:'live-v1',language:'en',role:'student',mode:'planning',profile:{name:'Synthetic',stage:'Community college'}};
 const invoke=async body=>{await handler(Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'}}),{writeHead:value=>status=value,end:value=>data=JSON.parse(value)},()=>assert.fail());};
 await invoke(input);assert.equal(status,200);assert.equal(data.voiceProvider,'live');assert.equal(data.voiceSession.language,'en');assert.equal(data.voiceSession.max_output_tokens,1500);assert.ok(!JSON.stringify(data).includes('Bearer'));assert.equal(calls,1);
 await invoke({...input,action:'update-guide',mode:'finance'});assert.equal(status,200);assert.match(data.session.liveInstructions,/Origen/);assert.equal(data.session.max_output_tokens,1500);assert.equal(calls,1);
 await invoke({...input,voiceProtocol:'other'});assert.equal(status,400);assert.equal(calls,1);
});

test('Live preserves the larger delegated response budget required by sharing and follow-through',()=>{
  const config=voiceSession({mode:'planning',language:'en',role:'student',reviewRequestVoice:true,profile:{}},{});
  assert.ok(config.tools.some(tool=>tool.name==='prepare_coordinator_review_request'));
  assert.equal(config.max_output_tokens,3000);
  assert.equal(studentLiveSession(config,{language:'en'}).delegation.responses.max_output_tokens,3000);
 });

for(const language of ['en','es'])test(`${language} scope and later configuration updates do not independently restart the opening`,()=>{
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId:'aiden',students:[{id:'aiden',name:'Aiden'}],profile:{name:'Aiden'},continuing:true};
 const first=studentLiveInstructions({...input,targetConfirmed:false,continuing:false});
 assert.match(first,/# Backchannel policy\nMostly quiet listening/);
 assert.match(first,/Acknowledgments before an answer are separate/);
 assert.match(first,/usually begin directly with the useful answer/);
 assert.match(first,/Do not produce consecutive or standalone hmm\/mm-hmm/);
 for(const updateInput of [input,{...input,mode:'finance'},{...input,language:language==='en'?'es':'en'}]){
  const instructions=studentLiveInstructions(updateInput,[],[],undefined,{update:true});
  assert.match(instructions,/configuration is silent context/);
  assert.match(instructions,/single continuation cue/);
  assert.match(instructions,/this scope description is context only and requests no opening question/);
  assert.doesNotMatch(instructions,/invite their priority|invite their next question|Invite a priority/);
 }
});
