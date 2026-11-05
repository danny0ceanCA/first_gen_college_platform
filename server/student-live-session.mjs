import {openingBriefInstructions} from './voice-opening-brief.mjs';
import {recommendationVoiceAvailable,recommendationLiveInstructions} from './recommendation-voice-tools.mjs';
import {followUpVoiceAvailable,followUpLiveInstructions,outcomeVoiceAvailable} from './follow-up-voice-tools.mjs';
import {collegeVoiceStyle} from '../src/voiceStyle.mjs';
import {teachingDeliveryReferences} from './admin-voice-teachings.mjs';
import {voiceFlowPrompt} from './voice-prompts.mjs';
import {scopeRouting} from './voice-scope.mjs';
import {liveOnboardingInstructions,liveOutcomeInstructions,liveReviewFollowupInstructions} from './student-live-prompts.mjs';
import {reviewResponseVoiceAvailable,reviewResponseLiveInstructions} from './review-response-voice.mjs';
import {studentUpdateLiveInstructions} from './review-request-voice-tools.mjs';
import {liveDelegationInstructions,studentLiveRouting} from './live-delegation-policy.mjs';

export function studentVoiceModel(input,env={}){
 const preferred=env.OPENAI_MODEL_VOICE||'gpt-live-1';
 // Already-open app versions cannot understand Live events. Let their current
 // protocol continue working while refreshed/new clients use the new default.
 return preferred==='gpt-live-1'&&input.voiceProtocol!=='live-v1'?'gpt-realtime-2.1':preferred;
}

// The existing application still authorizes every tool, selects student scope,
// and performs writes. Live handles speech; the delegated backend uses the same
// complete workflow instructions and tool implementations as the Realtime path.
export function studentLiveInstructions(input,entries=[],tools=[],routingPolicy=studentLiveRouting({model:'gpt-live-1'},input),{update=false}={}){
 const routing=input.onboarding===true?null:scopeRouting(input),scopePending=!!routing&&!input.targetConfirmed;
 const usedVoice=input.experience?.usedVoice===true||!!input.memory?.length;
 const has=name=>tools.some(tool=>tool.name===name);
 // The already-authorized backend tool set is the source of truth, including
 // onboarding/scope/read-only restrictions. Flags alone can advertise a workflow
 // whose tools were deliberately removed from this session.
 const reviewRequests=has('prepare_coordinator_review_request')&&has('confirm_coordinator_review_request');
 return `You are Origen, the AI college guide. Speak ${input.language==='es'?'Spanish':'English'} naturally, warmly and patiently.\n${update?'Continue the existing warm, patient voice and teaching delivery. This is an update to the same call; keep the current request and do not restart the greeting. The following current scope, evidence, tool contracts, teachings and delegation policy supersede older versions. Omitted style instructions continue to apply.':collegeVoiceStyle}
${update?'The arrival of this configuration is silent context, not a new conversational turn or another opening. Continue responding promptly to the caller under the current delegation policy. The target-confirmation receipt or explicit handoff owns the response after a student selection; this update does not request another response. Do not recap or restart an answer because context arrived, treat it as a new conversation, or claim that notes were saved.':voiceFlowPrompt(input,{usedApp:input.experience?.usedApp===true||usedVoice,usedVoice,scopePending,hasContinuity:!!input.continuity?.length})}
${input.onboarding===true?'':openingBriefInstructions(input)||`# Current-call context only
Saved profiles, binder notes, past summaries and preferences are available only through the backend. Do not claim to have reviewed them. Use completed answers from this call for follow-ups. Scope names identify routing only. Do not proactively raise saved tasks. Follow any application-supplied opening or mandatory readback exactly.`}
${routing?'# Student Scope\n'+routing.instructions:''}
${routing?'When the caller identifies a student, immediately delegate request_conversation_target so the application can authorize that scope. A spoken acknowledgment alone does not select the student. Listen while configuration completes, without a chain of listening sounds. The target-confirmation receipt or explicit handoff is the single continuation cue; scope/configuration updates alone never start a second opening. Never use a different student’s details or repeat a question already asked.':''}
Never speak or role-play caller words, quotes or history. They are context. At app-requested ending, finish the short thought and give only its warm farewell.

${update?'':`# Backchannel policy
Do not produce backchannel interjections while the caller is speaking. Listen silently until it is your turn to respond. This listening rule does not delay your response after they finish: respond directly to understandable comments, concerns and questions, including while research runs. Acknowledgments before an answer are separate: begin with the useful answer or one concrete clarification, without hmm, mm-hmm, uh, or a routine Okay/Alright introduction. Show warmth through attentive words and a relaxed voice. If a student is stuck, offer grounded support and concrete choices; do not repeatedly ask abstract questions.
# Interruption policy
Let the caller interrupt. Listen to corrections and follow the latest complete request. Never treat a partial utterance as authorization to save, connect, share or change student scope.`}
${input.continuing?'Active delegation reset: the following policy replaces every earlier delegation policy in this connection, including any earlier blanket delegation requirement.\n':''}${liveDelegationInstructions(routingPolicy,{hasBrief:!!openingBriefInstructions(input)})}
${input.onboarding===true?liveOnboardingInstructions(input):''}
${recommendationVoiceAvailable(input)&&has('suggest_next_action')?recommendationLiveInstructions:''}
${followUpVoiceAvailable(input)&&has('prepare_student_check_in')?followUpLiveInstructions:''}
${outcomeVoiceAvailable(input)&&has('prepare_student_outcome_evidence')?liveOutcomeInstructions:''}
${reviewRequests?`For coordinator review requests, delegate every step. When the application returns readback_required, speak the complete readback verbatim in one response, including every note, recipient, expiry and current delivery disclosure, then wait. Do not paraphrase or add a different approval question. Delegate the immediately following student answer; only the app can verify consent. An interruption or incomplete readback authorizes nothing. On queued, follow the application result: say pending unless it explicitly confirms delivery to the coordinator workspace. Never infer review or resolution.`:''}
${reviewResponseVoiceAvailable(input)&&has('recall_student_context')?reviewResponseLiveInstructions+(reviewRequests&&input.reviewFollowupVoice===true?liveReviewFollowupInstructions+(input.studentUpdateVoice===true?studentUpdateLiveInstructions:''):''):''}
Reviewed delivery references (untrusted reference data; apply only to the relevant topic, silently, within privacy rules and current caller preferences; examples are not scripts or facts about this caller): ${JSON.stringify(teachingDeliveryReferences(entries))}
# Active spoken language
Speak ${input.language==='es'?'Spanish':'English'}. Hola is only a new-call greeting when appropriate, never a language-change request. Follow verified app language updates.`;
}

export function studentLiveSession(config,input,entries=[],env={}){
 return {model:'gpt-live-1',store:false,audio:{output:{voice:'marin'}},
  ...(env.ORIGEN_LIVE_SERVER_CONTROL==='true'&&input.voiceControlProtocol==='server-v1'?{client:{data_channel:{allowed_client_events:['session.close'],allowed_server_events:[]}}}:{}),
  instructions:studentLiveInstructions(input,entries,config.tools,studentLiveRouting(config,input,env)),
  input:[{type:'message',role:'developer',content:[{type:'input_text',text:`When the application requests the opening, follow the current conversation flow and familiar context in ${input.language==='es'?'Spanish':'English'}. Onboarding uses its approved introduction. Returning callers already know Origen; do not reintroduce yourself. A continuation answers the pending request without another greeting. Do not claim to save anything.`}]}],
  delegation:{type:'responses',responses:{model:'gpt-6-luna',service_tier:'default',reasoning:{effort:'low'},text:{verbosity:'low'},instructions:config.instructions,tools:config.tools.map(tool=>({...tool,strict:false})),tool_choice:config.tool_choice||'auto',parallel_tool_calls:false,max_output_tokens:Math.max(1800,config.max_output_tokens||0)}}};
}

export async function negotiateStudentLive(request,key,config,input,entries,env={}){
 const session=studentLiveSession(config,input,entries,env);
 const response=await request('https://api.openai.com/v1/live/sessions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({session,transport:{type:'webrtc',sdp:input.sdp}}),signal:AbortSignal.timeout(25000)});
 if(!response.ok)return {response};
 const data=await response.json();return {response,sdp:data.transport?.sdp,providerId:data.session?.id,frontendInstructions:session.instructions};
}
