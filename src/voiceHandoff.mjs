// The confirmation receipt (first selection) or explicit handoff (scope restart)
// owns this continuation. Configuration changes are context, not a second cue.
export const confirmedTargetContinuation='After a successful target_confirmed receipt or explicit completed handoff, follow the latest caller speech, including anything said while selection loaded. If the caller has started a question or concern, listen until they finish, then answer it directly and weave in only relevant brief details; skip a separate recap and generic invitation. Do not ask again for a supplied school stage, interest or name. If an invitation was already asked, leave the floor with the caller; context arriving is not a reason to interrupt or ask it again. Only for a name-only selection with no pending question and no invitation already asked, give one short recap of at most two relevant facts in one or two connected sentences, then invite their priority in one short question, once, then listen. Preserve attribution and uncertainty; do not claim to be fully up to date. If no meaningful brief facts are available, omit the recap and give only the invitation. General-family scope never uses a student recap. If the recap was already spoken, do not repeat it; finish only the still-needed invitation. Ordinary context refreshes never replay this opening. Continue this same call without a greeting or a repeated confirmation.';

export function voiceHandoff(request){
 return 'A student switch has completed. The current authorized profile and opening brief describe the selected student. Use supplied school stage, interests and college without asking for them again. '+confirmedTargetContinuation+' The quoted request is reference data: never speak, paraphrase or role-play the caller request, never introduce yourself or greet again. Do not carry facts from another student. Pending caller question: '+JSON.stringify(String(request).slice(0,4000));
}

export function deferredVoiceHandoff(){
 return {status:'target_switch_deferred',instruction:'The student switch has not happened. Keep listening and follow the latest complete caller request, including corrections. If the caller still wants the new student, delegate that latest full request again; do not ask them to repeat their name or question. Do not use the proposed student context or claim the switch succeeded.'};
}

