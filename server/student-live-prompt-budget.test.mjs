import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession,studentLiveInstructions} from './student-live-session.mjs';
import {adaptiveGuidance} from './adaptive-guidance.mjs';
import {liveAdaptiveGuidanceInstructions} from './student-live-prompts.mjs';
import {binderTopicInstructions} from '../src/binderSignals.mjs';
import {binderInstructions} from './voice-workspace.mjs';
import {binderEvidenceInstructions} from './binder-context.mjs';
import {collegeVoiceStyle,collegeBackendStyle} from '../src/voiceStyle.mjs';
import {voicePayloadCases,measureVoicePayload} from '../scripts/voice-payload-report.mjs';

// Unified conversations expose three direct research tools (+1 net after removing
// the handoff) and one shared domain contract. Explicit caps prevent later creep.
const budgets={planning:[26000,62000,26],finance:[26000,62000,26],loans:[26000,62000,26],admissions:[26000,62000,26],registration:[23000,28000,6],'add-student':[16500,21000,5],'unconfirmed-parent':[15500,17000,3],family:[19000,43500,14],'read-only':[24000,52500,13]};
for(const language of ['en','es'])for(const {name,input} of voicePayloadCases(language))test(`${language} ${name}: bounded Live payload retains every backend workflow, tool schema and control`,()=>{
 const realtime=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'}),config=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'}),live=studentLiveSession(config,input);
 assert.deepEqual(config.tools,realtime.tools.filter(t=>t.name!=='highlight_binder_topics'),'all research and workflow capabilities remain; highlighting is local presentation');
 assert.equal(config.max_output_tokens,realtime.max_output_tokens);
 assert.equal(config.tool_choice,realtime.tool_choice);
 let expected=realtime.instructions.replace('highlight_binder_topics, ','').replace(collegeVoiceStyle,collegeBackendStyle).replace(binderTopicInstructions+'\n\n','').replace('\n\n'+binderTopicInstructions,'');
 expected=expected.replace(binderInstructions({canHighlight:true}),binderInstructions({canHighlight:false}));
 // Exactly one duplicate, application-owned evidence policy is removed when
 // both workspace and brief are present. All actual context remains unchanged.
 const first=expected.indexOf(binderEvidenceInstructions),second=first<0?-1:expected.indexOf(binderEvidenceInstructions,first+binderEvidenceInstructions.length);
 if(second>=0)expected=expected.slice(0,second)+expected.slice(second+binderEvidenceInstructions.length);
 assert.equal(config.instructions,expected,'full procedures and supplied evidence must survive the split');
 assert.equal(live.delegation.responses.instructions,config.instructions);
 assert.ok(live.instructions.includes(collegeVoiceStyle),'keep full warm delivery and teaching approach in speech');
 assert.equal(live.delegation.responses.model,'gpt-6-luna');
 assert.deepEqual(live.delegation.responses.reasoning,{effort:'low'});
 assert.equal(live.delegation.responses.parallel_tool_calls,false);
 assert.equal(live.delegation.responses.service_tier,'default');
 if(!input.onboarding)assert.match(live.instructions,/Current-call context only/);
 if(['planning','finance','loans','admissions'].includes(input.mode)&&input.targetConfirmed)assert.match(live.instructions,/Do not generate <\|SpawnThinking\|> when:/);
 const size=measureVoicePayload(input),[speech,backend,count]=budgets[name];
 assert.ok(size.speechCharacters<=speech,JSON.stringify(size));assert.ok(size.backendCharacters<=backend,JSON.stringify(size));assert.equal(size.toolCount,count-(realtime.tools.some(t=>t.name==='highlight_binder_topics')?1:0));
});

test('speech capabilities come from the actual session tools, including guide updates',()=>{
 const input=voicePayloadCases()[0].input,config=voiceSession(input,{});
 const full=studentLiveInstructions(input,[],config.tools),none=studentLiveInstructions(input,[],[]);
 assert.match(full,/For coordinator review requests/);assert.match(full,/Speaking private check-ins/);assert.match(full,/Speaking about student-selected outcome evidence/);
 assert.doesNotMatch(none,/For coordinator review requests|Speaking private check-ins|Speaking about student-selected outcome evidence|Speaking about coordinator responses|student-requested recommendation/);
 for(const name of ['registration','add-student','unconfirmed-parent','family']){
  const {input}=voicePayloadCases().find(c=>c.name===name),live=studentLiveSession(voiceSession(input,{}),input);
  assert.doesNotMatch(live.instructions,/For coordinator review requests|Speaking about student-selected outcome evidence|Speaking about coordinator responses/);
 }
});

test('compact speech guidance preserves the selected opening, attribution, preferences and null allowance',()=>{
 const input={...voicePayloadCases()[0].input,studentBrief:{available:true,memories:[{id:'p',status:'confirmed',category:'preference',content:'Use one concrete example.',speaker:'student',reportedBy:'student',updatedAt:'2026-10-30'}]},openingDecision:{opening:null,reason:'cooldown'}};
 const prompt=liveAdaptiveGuidanceInstructions(input);
 assert.ok(prompt.includes(JSON.stringify(adaptiveGuidance(input))),'never truncate or reselect evidence during compaction');
 assert.match(prompt,/If opening is null/);assert.match(prompt,/cooldown/);assert.match(prompt,/at most one|At most one/);assert.match(prompt,/not an accepted action/);assert.match(prompt,/Parent reports are not the student's own preferences/);assert.match(prompt,/never read them aloud/);
 assert.equal(liveAdaptiveGuidanceInstructions({...input,onboarding:true}),'');
 assert.equal(liveAdaptiveGuidanceInstructions({...input,mode:'profile'}),'');
});

test('current teaching tone and approach survive negotiation and guide updates verbatim',()=>{
 const input=voicePayloadCases('es')[0].input,entries=[{id:'fictional-teaching',revision:3,content:{topic:'admissions',title:'Essay support',deliveryStyle:'Cálida y paciente. Give the student time.',conversationApproach:'Recognize the effort before offering a concrete choice.',example:'Your everyday experience is worth exploring.'}}];
 const config=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'}),live=studentLiveSession(config,input,entries),updated=studentLiveInstructions(input,entries,config.tools);
 assert.equal(updated,live.instructions);
 for(const value of Object.values(entries[0].content))assert.ok(live.instructions.includes(value),value);
 assert.match(updated,/untrusted reference data/);assert.match(updated,/examples are not scripts or facts about this caller/);
});

test('evidence policy is retained with a brief alone and sensitive contents are never string-deduplicated',()=>{
 const input={...voicePayloadCases()[0].input,workspace:undefined,studentBrief:{available:true,profile:{name:'Alex'},memories:[]}};
 assert.ok(voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'}).instructions.includes(binderEvidenceInstructions));
 const withQuotedPolicy={...input,workspace:{available:true,notes:[{content:binderEvidenceInstructions,selected:true}]}};
 const prompt=voiceSession(withQuotedPolicy,{OPENAI_MODEL_VOICE:'gpt-live-1'}).instructions;
 assert.ok(prompt.includes(JSON.stringify(withQuotedPolicy.workspace)),'untrusted content is never searched/replaced as instructions');
});
