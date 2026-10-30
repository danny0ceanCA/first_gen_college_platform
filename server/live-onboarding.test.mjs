import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {accountDraftProposal} from '../src/voiceAccountDraft.mjs';
import {studentLiveChannel} from '../src/studentLiveChannel.mjs';
import {voiceProfileSaveConsent} from '../src/voiceProfileSave.mjs';
import {voiceDraft} from '../src/voiceDraft.mjs';

test('account answers can fill one field immediately without guessing or clearing the other',()=>{
 let account={firstName:'',role:''};
 account={...account,...accountDraftProposal({firstName:' Daniel '})};
 assert.deepEqual(account,{firstName:'Daniel',role:''});
 account={...account,...accountDraftProposal({role:'parent'})};
 assert.deepEqual(account,{firstName:'Daniel',role:'parent'});
 for(const value of [{},null,[],{firstName:''},{firstName:'x'.repeat(101)},{role:'teacher'},{role:'student',email:'forged'}])assert.equal(accountDraftProposal(value),null);
});

for(const language of ['en','es'])for(const collectAccount of [true,false])test(`Live ${language} ${collectAccount?'registration':'add-student'} shares guided onboarding and keeps tool boundaries`,()=>{
 const input={mode:'profile',onboarding:true,collectAccount,saveOnboarding:true,language,role:'parent',profile:{name:'',stage:''},allowGuideHandoff:true,liveMemoryEnabled:true,coordinatorLinking:true};
 const config=voiceSession(input,{}),live=studentLiveSession(config,input);
 for(const instructions of [live.instructions,live.delegation.responses.instructions]){
  assert.match(instructions,/account name and role when needed, student name, then education stage/);
  assert.match(instructions,/Do not open with vague questions/);
  assert.match(instructions,/form fills while the person talks/);
  assert.match(instructions,/PIQs, essays, admissions, aid or college mentions are profile context/);
  assert.match(instructions,/Only say saved after the tool returns saved/);
  assert.match(instructions,/something you and the caller are building together/);
  assert.match(instructions,/before the tool confirms it/);
  assert.match(instructions,/NOT a script or a required sequence/);
  assert.match(instructions,language==='es'?/Ahora, para tu perfil/:/Next, for your profile/);
  assert.match(instructions,/A clear correction is enough to update the unsaved form/);
  assert.match(instructions,/Do not confirm every field separately/);
  assert.match(instructions,/Only ask about a transfer subject when they have expressed transfer interest/);
  assert.match(instructions,language==='es'?/¿Estás en la secundaria, en un colegio comunitario o en otra etapa\?/:/Are you in high school, attending community college, or somewhere else\?/);
  assert.doesNotMatch(instructions,/keep the opening to one or two sentences/,'ordinary greeting limits cannot override the onboarding welcome');
 }
 assert.match(live.instructions,/For EVERY answer containing an account or student detail/);
 assert.ok(config.tools.every(tool=>['propose_account','propose_profile','save_onboarding_profile','set_conversation_language','end_conversation'].includes(tool.name)));
 if(collectAccount){const tool=config.tools.find(tool=>tool.name==='propose_account');assert.deepEqual(tool.parameters.required,[]);assert.equal(tool.parameters.minProperties,1);}
 else{assert.ok(!config.tools.some(tool=>tool.name==='propose_account'));assert.match(live.instructions,/Do not ask for account-holder name\/role/);}
});

for(const language of ['en','es'])test(`Live ${language} delegated draft events reach the form without save consent`,async()=>{
 const consent=voiceProfileSaveConsent(),events=[],raw={readyState:'open',send(){},close(){}},form={account:{firstName:'',role:''},student:{name:'',stage:''}};
 const draft=voiceDraft(null,true),channel=studentLiveChannel(raw,{getTurn:()=>consent.token()});
 channel.configure({voiceProvider:'live',voiceSession:{onboarding:true}});
 channel.onmessage=({data})=>{
  const e=JSON.parse(data);events.push(e);
  if(e.type==='input_audio_buffer.speech_started')consent.begin(e.item_id);
  if(e.type==='conversation.item.input_audio_transcription.completed')consent.transcript(e.item_id,e.transcript);
  if(e.type==='response.done')for(const item of e.response.output||[]){
   assert.equal(e.response.metadata.origen_user_turn,consent.token());
   const args=JSON.parse(item.arguments);
   if(item.name==='propose_account')form.account={...form.account,...accountDraftProposal(args)};
   if(item.name==='propose_profile')draft.accept({},Object.fromEntries(args.changes.map(change=>[change.field,change.value])),changes=>Object.assign(form.student,changes));
  }
 };
 const receive=e=>raw.onmessage({data:JSON.stringify(e)});
 receive({type:'session.started'});
 receive({type:'session.input_transcript.delta',delta:language==='es'?'Soy Daniel, su papá. Mi estudiante es Elena y estudia en un colegio comunitario.':'I am Daniel, her dad. My student is Elena, at community college.'});
 receive({type:'response.event',delegation_id:'d',event:{type:'response.created',response:{id:'r'}}});
 // Actual Live nested tool-item events need not contain response_id.
 for(const [name,args] of [['propose_account',{firstName:'Daniel',role:'parent'}],['propose_profile',{changes:[{field:'name',value:'Elena'},{field:'stage',value:'Community college'}]}]])receive({type:'response.event',delegation_id:'d',event:{type:'response.output_item.done',item:{type:'function_call',name,call_id:name,arguments:JSON.stringify(args)}}});
 receive({type:'response.event',delegation_id:'d',event:{type:'response.completed',response:{id:'r',status:'completed'}}});
 await new Promise(resolve=>setTimeout(resolve,1250));
 assert.deepEqual(form,{account:{firstName:'Daniel',role:'parent'},student:{name:'Elena',stage:'Community college'}});
 assert.equal(consent.consume(consent.token()),false,'recording answers never grants save consent');
 // The same nested Live path must replace an earlier value, preserve unrelated
 // details, and leave the profile unsaved until a separate explicit request.
 receive({type:'session.input_transcript.delta',delta:language==='es'?'En realidad, se llama Ana.':'Actually, her name is Ana.'});
 receive({type:'response.event',delegation_id:'correction',event:{type:'response.created',response:{id:'r-correction'}}});
 receive({type:'response.event',delegation_id:'correction',event:{type:'response.output_item.done',item:{type:'function_call',name:'propose_profile',call_id:'correct-name',arguments:JSON.stringify({changes:[{field:'name',value:'Ana'}]})}}});
 receive({type:'response.event',delegation_id:'correction',event:{type:'response.completed',response:{id:'r-correction',status:'completed'}}});
 await new Promise(resolve=>setTimeout(resolve,1250));
 assert.deepEqual(form,{account:{firstName:'Daniel',role:'parent'},student:{name:'Ana',stage:'Community college'}});
 assert.equal(consent.consume(consent.token()),false,'correcting a field is not final save consent');
 channel.close();
});
