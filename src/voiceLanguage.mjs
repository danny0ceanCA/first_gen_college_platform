import {voiceGuideUpdate} from './voiceGuideUpdate.mjs';

export const bilingualTranscriptionPrompt='This college guidance conversation may contain English, Spanish, or both in the same sentence. Transcribe the words in their spoken language, without translating. Vocabulary may include Origen, FAFSA, financial aid, community college, universidad, colegio comunitario, transferencia, and ayuda financiera. Do not invent words from silence or unclear audio.';

export function voiceLanguageInstructions(instructions,language){
 if(!['en','es'].includes(language)||typeof instructions!=='string')throw new Error('invalid_voice_language');
 const base=instructions.replace(/\n<origen-language>[\s\S]*?<\/origen-language>/g,'');
 return `${base}\n<origen-language>Current conversation language: ${language==='es'?'Spanish':'English'}. Use this language for the next reply, explanations and research, even if an earlier instruction, greeting, summary or source used another language. This overrides the initial language preference. A language change continues the same conversation: do not greet again, repeat onboarding, or ask the user to confirm a switch. Keep listening to either language, including mixed English and Spanish. An understandable question or sentence in the other language is enough to switch: call set_conversation_language before other tools, then answer that question. An isolated name, college acronym, quoted form label or English term explained in Spanish is not a switch; neither is silence, noise or unclear audio. If the person explicitly requests a response language, follow that preference rather than the language of the request.</origen-language>`;
}

/** One ordered configuration stream prevents language and specialist changes from overwriting each other. */
export function voiceLanguageControl(send,{language='en',onLanguage=()=>{},...timers}={}){
 const updates=voiceGuideUpdate(send,timers);
 let current=language,instructions='',tail=Promise.resolve(),stopped=false,revision=0,applied=0,uncertain=false;
 const enqueue=task=>{const job=tail.then(()=>{if(stopped)throw new Error('voice_session_stopped');return task();});tail=job.catch(()=>{});return job;};
 const apply=async(session,next,callback)=>{
  const version=++revision;
  try{await updates.update(session,()=>{
   // An acknowledgement that arrives after a newer update must not undo it.
   if(stopped||version<applied)return;
   applied=version;instructions=session.instructions;current=next;uncertain=false;onLanguage(next);callback?.();
  });}catch(error){uncertain=true;throw error;}
 };
 return {
  language:()=>current,
  event(event){if(event.type==='session.created'&&typeof event.session?.instructions==='string')instructions=event.session.instructions;return updates.event(event);},
  change(next){return enqueue(async()=>{
   if(!['en','es'].includes(next))return false;
   if(next===current&&!uncertain)return true;
   if(!instructions)throw new Error('voice_session_not_ready');
   await apply({type:'realtime',instructions:voiceLanguageInstructions(instructions,next)},next);
   return true;
  });},
  configure(build,onApplied){return enqueue(async()=>{
   const session=await build(current);
   if(stopped)throw new Error('voice_session_stopped');
   if(typeof session?.instructions!=='string'||!Array.isArray(session.tools))throw new Error('invalid_guide_config');
   const next={...session,instructions:voiceLanguageInstructions(session.instructions,current)};
   await apply(next,current,onApplied);
   return true;
  });},
  stop(){stopped=true;updates.stop();},
 };
}

/** Process language first even when the model puts scope/research tools before it. */
export async function voiceLanguageTools(output,control,send){
 let count=0;
 for(const item of output){
  if(item.type!=='function_call'||item.name!=='set_conversation_language')continue;
  count++;let status='invalid_language';
  try{
   const args=JSON.parse(item.arguments);
   if(['en','es'].includes(args?.language))status=await control.change(args.language)?'language_updated':'invalid_language';
  }catch{status='language_change_failed';}
  send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status,language:control.language(),instruction:status==='language_updated'?'Continue in the current language without greeting or confirming again.':'Continue the conversation; do not repeatedly retry the same language tool.'})}});
 }
 return count;
}
