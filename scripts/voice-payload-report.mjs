// Deterministic, fictional payload inspection: no database, credentials or API calls.
import {pathToFileURL} from 'node:url';
import {voiceSession} from '../server/profile-voice.mjs';
import {studentLiveSession} from '../server/student-live-session.mjs';

export function voicePayloadCases(language='en'){
 const base={language,role:'student',studentId:'fictional-student',targetConfirmed:true,voiceProtocol:'live-v1',profile:{name:'Alex',stage:'Community college',school:'Fictional Community College',goals:'Explore transfer options'},experience:{usedApp:true,usedVoice:true},caller:{firstName:'Alex'},allowGuideHandoff:true,liveMemoryEnabled:true,guidedConversation:true,coordinatorLinking:true,reviewRequestVoice:true,reviewResponseVoice:true,reviewFollowupVoice:true,studentUpdateVoice:true,studentFollowUpVoice:true,recommendationVoice:true,studentOutcomeVoice:true,studentBrief:{available:true,profile:{name:'Alex'},memories:[],plans:[]},workspace:{available:true,notes:[],actions:[]},openingDecision:{opening:null,reason:'none'}};
 return [
  ...['planning','finance','loans','admissions'].map(mode=>({name:mode,input:{...base,mode}})),
  {name:'registration',input:{...base,mode:'profile',onboarding:true,collectAccount:true,saveOnboarding:true}},
  {name:'add-student',input:{...base,mode:'profile',onboarding:true,collectAccount:false,saveOnboarding:true}},
  {name:'unconfirmed-parent',input:{...base,mode:'planning',role:'parent',routeConversations:true,targetConfirmed:false,students:[{id:base.studentId,name:'Alex'}]}},
  {name:'family',input:{...base,mode:'planning',role:'parent',routeConversations:true,studentId:null,profile:{},students:[]}},
  {name:'read-only',input:{...base,mode:'planning',liveMemoryWriteEnabled:false}},
 ];
}

export function measureVoicePayload(input,entries=[]){
 const config=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'});
 const live=studentLiveSession(config,input,entries);
 return {speechCharacters:live.instructions.length,backendCharacters:config.instructions.length,toolCount:config.tools.length,toolSchemaBytes:Buffer.byteLength(JSON.stringify(live.delegation.responses.tools)),sessionBytes:Buffer.byteLength(JSON.stringify(live))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const language of ['en','es'])for(const {name,input} of voicePayloadCases(language))console.log(JSON.stringify({language,scenario:name,...measureVoicePayload(input)}));
}
