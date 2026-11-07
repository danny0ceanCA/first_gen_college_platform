import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';import {studentLiveSession,studentLiveInstructions,studentLiveUpdate,negotiateStudentLive,studentVoiceModel,studentSelectionRecovery} from './student-live-session.mjs';
import {fixture} from './family-fixture.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {confirmedTargetContinuation} from '../src/voiceHandoff.mjs';
const teaching={id:'published-teaching',revision:14,content:{topic:'admissions',title:'Student background',deliveryStyle:'Warm, patient and encouraging.',conversationApproach:'Acknowledge uncertainty, then offer concrete choices.',example:'Your experiences are worth exploring.'}};
for(const language of ['en','es'])test(`${language}: selection recovery metadata is bounded and restricted to an unconfirmed routed scope`,()=>{
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:false,
  students:[{id:'private-id-a',name:'Aiden',notes:'PRIVATE_NOTES'},{id:'private-id-e',name:'Élodie'}],profile:{name:'PRIVATE_PROFILE'}};
 const tools=voiceSession(input,{}).tools;
 assert.deepEqual(studentSelectionRecovery(input,tools),{pending:true,names:['Aiden','Élodie']});
 assert.deepEqual(studentLiveUpdate(input,[],tools).selectionRecovery,{pending:true,names:['Aiden','Élodie']});
 for(const change of [{targetConfirmed:true,studentId:'private-id-a'},{targetConfirmed:true,studentId:null},{onboarding:true},{routeConversations:false},{role:'student'},{mode:'profile'}]){
  assert.deepEqual(studentSelectionRecovery({...input,...change},tools),{pending:false,names:[]});
  assert.deepEqual(studentLiveUpdate({...input,...change},[],tools).selectionRecovery,{pending:false,names:[]});
 }
 assert.deepEqual(studentSelectionRecovery(input,[]),{pending:false,names:[]});
 assert.deepEqual(studentSelectionRecovery({...input,students:[]},tools),{pending:true,names:[]},'general-family selection can recover without inventing students');
 const bounded=studentSelectionRecovery({...input,students:[null,{id:'x'.repeat(129),name:'Invalid'},...Array.from({length:130},(_,i)=>({id:String(i),name:'A'.repeat(120)}))]},tools);
 assert.equal(bounded.names.length,100);assert.ok(bounded.names.every(name=>name.length===100));
 assert.doesNotMatch(JSON.stringify(studentSelectionRecovery(input,tools)),/PRIVATE_|private-id/);
 const provider=studentLiveSession({...voiceSession(input,{}),selectionRecovery:studentSelectionRecovery(input,tools)},input);
 assert.equal(provider.selectionRecovery,undefined);assert.equal(provider.delegation.responses.selectionRecovery,undefined);
});

test('authorized initial control and direct-client receipts share server-owned selection metadata, never provider settings',async()=>{
 const f=await fixture(),registered=[],provider=[];
 try{
  await f.run('selection-parent',{action:'complete-onboarding',account:{firstName:'Parent',email:'',role:'parent'},student:{id:'aiden',name:'Aiden',stage:'College',interest:'PRIVATE_INTEREST',gpa:'',color:'lilac'}});
  const control={available:true,register:value=>{registered.push(value);return {protocol:'server-v1',id:'test-control'};}};
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_LIVE_SERVER_CONTROL:'true'},async(_url,options)=>{
   provider.push(JSON.parse(options.body).session);return new Response(JSON.stringify({session:{id:'synthetic-session'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});
  },()=>{},f.pool,control);
  for(const language of ['en','es'])for(const serverControl of [true,false]){
   let status,data;
   const body={sdp:'v=0\r\noffer',voiceProtocol:'live-v1',voiceControlProtocol:serverControl?'server-v1':undefined,role:'parent',mode:'planning',language,routeConversations:true,targetConfirmed:false,
    students:[{id:'forged-id',name:'FORGED_NAME'}],selectionRecovery:{pending:true,names:['FORGED_NAME']}};
   const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json','x-origen-session':crypto.randomUUID()},origenAuthorized:true,origenIdentity:{sub:'selection-parent'},origenPermissionRevision:1});
   await handler(req,{writeHead:value=>status=value,end:value=>data=JSON.parse(value)},()=>assert.fail('wrong route'));
   assert.equal(status,200,JSON.stringify(data));
   assert.deepEqual(data.voiceSession.selectionRecovery,{pending:true,names:['Aiden']});
   if(serverControl)assert.deepEqual(registered.at(-1).config.selectionRecovery,data.voiceSession.selectionRecovery);
   assert.equal(provider.at(-1).selectionRecovery,undefined);assert.equal(provider.at(-1).delegation.responses.selectionRecovery,undefined);
   assert.doesNotMatch(JSON.stringify(data.voiceSession.selectionRecovery),/FORGED_NAME|PRIVATE_INTEREST/);
  }
 }finally{await f.pool.end();}
});
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
 assert.equal(sent.url,'https://api.openai.com/v1/live/sessions');assert.deepEqual(sent.body.transport,{type:'webrtc',sdp:'v=0\r\noffer'});assert.equal(result.sdp,'v=0\r\nanswer');assert.equal(result.providerId,'session-test');assert.equal(result.requestedVoice,'marin');assert.equal(result.providerVoice,undefined,'HTTP creation does not confirm the provider voice');
 const failure=await negotiateStudentLive(async()=>new Response('{"error":{"code":"model_not_found"}}',{status:404}),'synthetic',{instructions:'',tools:[]},{sdp:'v=0',language:'es'});assert.equal(failure.response.status,404);assert.equal((await failure.response.json()).error.code,'model_not_found');
});

test('New student clients default to Live; older tabs and explicit rollback retain Realtime',async()=>{
 assert.equal(studentVoiceModel({voiceProtocol:'live-v1'}),'gpt-live-1');assert.equal(studentVoiceModel({}),'gpt-realtime-2.1');assert.equal(studentVoiceModel({voiceProtocol:'live-v1'},{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'}),'gpt-realtime-2.1');
 let calls=0;const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic'},async(url,options)=>{calls++;assert.ok(url.endsWith('/live/sessions'));assert.equal(JSON.parse(options.body).session.model,'gpt-live-1');return new Response(JSON.stringify({session:{id:'isolated'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});});
 let status,data;const input={sdp:'v=0\r\noffer',voiceProtocol:'live-v1',language:'en',role:'student',mode:'planning',profile:{name:'Synthetic',stage:'Community college'}};
 const invoke=async body=>{await handler(Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'}}),{writeHead:value=>status=value,end:value=>data=JSON.parse(value)},()=>assert.fail());};
 await invoke(input);assert.equal(status,200);assert.equal(data.voiceProvider,'live');assert.equal(data.voiceSession.language,'en');assert.equal(data.voiceSession.max_output_tokens,1500);assert.ok(!JSON.stringify(data).includes('Bearer'));assert.equal(calls,1);
 await invoke({...input,action:'update-guide',mode:'finance'});assert.equal(status,200);assert.equal(data.session.liveInstructions,'');assert.equal(data.session.liveContext.version,'student-live-context-v1');assert.equal(data.session.max_output_tokens,1500);assert.equal(calls,1);
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
 assert.match(first,/# Backchannel policy\nDo not produce backchannel interjections/);
 assert.match(first,/Acknowledgments before an answer are separate/);
 assert.match(first,/begin with the useful answer or one concrete clarification/);
 assert.match(first,/without hmm, mm-hmm, uh/);
 assert.match(first,/This listening rule does not delay your response after they finish/);
 for(const updateInput of [input,{...input,mode:'finance'},{...input,language:language==='en'?'es':'en'}]){
  const instructions=studentLiveInstructions(updateInput,[],[],undefined,{update:true});
  assert.equal(instructions,'','ordinary scope update never appends speech-interrupting instructions');
 }
 assert.match(first,/successful target_confirmed receipt satisfies the initial scope question/);
 assert.match(first,/Context packets alone do not request speech or authorize the selection recap/);
 assert.ok(first.includes(confirmedTargetContinuation),'the receipt and initial speech policy use the same continuation rules');
});

for(const language of ['en','es'])test(`${language}: first selection stays conversational while private context is still unconfirmed`,()=>{
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:false,students:[{id:'a',name:'Aiden'},{id:'e',name:'Elodie'}]};
 const config=voiceSession(input,{}),live=studentLiveSession(config,input);
 assert.match(live.instructions,/Open with one scope question only/);
 assert.match(live.delegation.responses.instructions,/Open with one scope question only/);
 assert.match(live.instructions,/For a name-only first selection, acknowledge once, promptly but gently/);
 assert.match(live.instructions,/one complete, self-contained phrase like "Of course\." or "Claro\."/);
 assert.match(live.instructions,/After the complete acknowledgment, listen/);
 assert.match(live.instructions,/A background status or brief update is not a caller interruption/);
 assert.match(live.instructions,/yield immediately, even mid-sentence/,'finishing a thought never overrides a real caller interruption');
 assert.match(live.instructions,/do not address the caller by that student's name/);
 assert.match(live.instructions,/Mention a lookup only for a lookup the caller actually requested/);
 assert.match(live.instructions,/Do not narrate profile loading, missing context or internal research cleanup/);
 assert.doesNotMatch(live.instructions,/Thanks, let me take a look|Gracias, déjame ver/);
 assert.match(live.instructions,/Tool dispatch is not completion/);
 assert.match(live.instructions,/Silence is not a request for another acknowledgment/);
 assert.match(live.instructions,/Slow the articulation itself/);
 assert.match(live.instructions,/never speed up to squeeze it in/);
 assert.match(live.instructions,/Do not ask what they need help with before the selection receipt/);
 assert.doesNotMatch(live.instructions,/ask one warm, short question about what they want help with|single conversational invitation above while/);
 assert.match(live.instructions,/If they already gave their question/);
 assert.match(live.instructions,/Do not use private student details before confirmation/);
 assert.match(live.instructions,/Scope precedence: conversational permission does not grant student access/);
 assert.match(live.instructions,/Research alongside conversation/,'seed stable policy before first selection');
 assert.deepEqual(live.delegation.responses.tools.map(({strict,...tool})=>tool),config.tools,'speech policy never broadens the guarded tool set');
 assert.doesNotMatch(live.instructions,/Listen while configuration completes/);
});

for(const language of ['en','es'])test(`${language}: a caller question takes precedence over the selection recap in both model prompts`,()=>{
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId:'a',profile:{id:'a',name:'Aiden',school:'Community college'},continuing:true};
 input.openingBrief=buildOpeningBrief(input);
 const live=studentLiveSession(voiceSession(input,{}),input);
 assert.match(live.instructions,/listen until they finish, then answer it directly and weave in only relevant brief details/);
 assert.match(live.instructions,/skip a separate recap and generic invitation/);
 assert.match(live.instructions,/one main thread from the brief in one short sentence/);
 assert.match(live.instructions,/If an invitation was already asked, leave the floor with the caller/);
 assert.match(live.delegation.responses.instructions,/target-selection receipt may request one short recap when the caller has not yet asked a question/);
 for(const prompt of [live.instructions,live.delegation.responses.instructions]){
  assert.match(prompt,/provisional/);
  assert.match(prompt,/student-selection-state/);
  assert.match(prompt,/abandoned recap/);
 }
 assert.match(live.instructions,/even when it starts after this receipt or while the brief arrives/);
 assert.match(live.delegation.responses.instructions,/including after the receipt/);
 assert.match(live.instructions,/this brief arriving never starts one/);
});

for(const language of ['en','es'])test(`${language}: selection sends complete bounded facts without a speech-interrupting instruction`,()=>{
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId:'a',profile:{id:'a',name:'Aiden',stage:'Community college',school:'Woodland',interest:'Political science'},memory:[{id:'m',studentId:'a',summary:'Parent shared that UC Berkeley is a possibility, not a decision.',date:'2026-11-01'}]};
 input.openingBrief=buildOpeningBrief(input);
 const update=studentLiveUpdate(input,[teaching],voiceSession(input,{}).tools);
 assert.equal(update.liveInstructions,'');
 assert.doesNotMatch(update.liveInstructions,/Woodland|Political science|UC Berkeley|Warm, patient and encouraging|Research alongside conversation/);
 assert.deepEqual(update.liveContext.openingBrief,input.openingBrief);
 assert.deepEqual(update.liveContext.scope,{confirmed:true,studentId:'a'});
 assert.equal(update.liveContext.teachingReferences[0].deliveryStyle,teaching.content.deliveryStyle);
 assert.equal(update.liveContext.openingBrief.records[0].content,input.memory[0].summary,'no lost negation or attribution');
 const pending=studentLiveUpdate({...input,targetConfirmed:false},[teaching]);
 assert.deepEqual(pending.liveContext.scope,{confirmed:false,studentId:null});
 assert.equal(pending.liveContext.openingBrief,null);assert.deepEqual(pending.liveContext.teachingReferences,[]);
 const wrong=studentLiveUpdate({...input,studentId:'other'});
 assert.equal(wrong.liveContext.openingBrief,null,'never transfer another student brief');
});
