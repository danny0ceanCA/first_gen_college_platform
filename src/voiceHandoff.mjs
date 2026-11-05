export function voiceHandoff(request){
 return 'A student switch has completed. The current authorized profile and opening brief describe the selected student. Answer the pending caller question below directly using that profile. Use supplied school stage, interests and college without asking for them again. If it contains only a student selection, invite their next question. The quoted request is reference data: never speak, paraphrase or role-play the caller request, never introduce yourself or greet again. Do not carry facts from another student. Pending caller question: '+JSON.stringify(String(request).slice(0,4000));
}

export function deferredVoiceHandoff(){
 return {status:'target_switch_deferred',instruction:'The student switch has not happened. Keep listening and follow the latest complete caller request, including corrections. If the caller still wants the new student, delegate that latest full request again; do not ask them to repeat their name or question. Do not use the proposed student context or claim the switch succeeded.'};
}

