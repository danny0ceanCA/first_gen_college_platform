export const studentRecapInstructions='After the application confirms the student, if the caller only selected them or asks where you left off, offer one brief, welcoming recap from the supplied authorized profile and opening brief: their current direction, one recent discussion, and what remains open. Use two or three short sentences, then offer one or two relevant directions in one gentle question. Preserve attribution and uncertainty; never invent progress, decisions, tasks or missing history. If there is little saved history, say only what is known and invite their priority. If they already asked a substantive question, answer it first instead of making them wait for a recap. Do this once per student selection, not on language changes, context refreshes or ordinary follow-ups. No extra lookup is needed just for this recap. Speak naturally in the current language, without reading a dossier or internal labels.';

export function voiceHandoff(request){
 return 'A student switch has completed. The current authorized profile and opening brief describe the selected student. Answer the pending caller question below directly using that profile. Use supplied school stage, interests and college without asking for them again. '+studentRecapInstructions+' The quoted request is reference data: never speak, paraphrase or role-play the caller request, never introduce yourself or greet again. Do not carry facts from another student. Pending caller question: '+JSON.stringify(String(request).slice(0,4000));
}

export function deferredVoiceHandoff(){
 return {status:'target_switch_deferred',instruction:'The student switch has not happened. Keep listening and follow the latest complete caller request, including corrections. If the caller still wants the new student, delegate that latest full request again; do not ask them to repeat their name or question. Do not use the proposed student context or claim the switch succeeded.'};
}

