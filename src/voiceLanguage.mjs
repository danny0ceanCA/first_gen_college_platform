import {voiceGuideUpdate} from './voiceGuideUpdate.mjs';

export const bilingualTranscriptionPrompt='This college guidance conversation may contain English, Spanish, or both in the same sentence. Transcribe the words in their spoken language, without translating. Vocabulary may include Origen, FAFSA, financial aid, community college, universidad, colegio comunitario, transferencia, and ayuda financiera. Do not invent words from silence or unclear audio.';

export function voiceLanguageInstructions(instructions,language){
 if(!['en','es'].includes(language)||typeof instructions!=='string')throw new Error('invalid_voice_language');
 const base=instructions.replace(/\n<origen-language>[\s\S]*?<\/origen-language>/g,'');
 return `${base}\n<origen-language>Current conversation language: ${language==='es'?'Spanish':'English'}. Use this language for EVERY complete sentence in the next reply, explanations and research, even if an earlier instruction, greeting, summary or source used another language. Do not alternate English and Spanish sentences or translate every sentence twice. In Spanish, an official English key term may be named briefly, immediately defined in Spanish, then continue entirely in Spanish. This overrides the initial language preference. A language change continues the same conversation: do not greet again, repeat onboarding, or ask the user to confirm a switch. Keep listening to either language, including mixed English and Spanish. An understandable question or sentence in the other language is enough to switch: call set_conversation_language before other tools, then answer that question entirely in the new language. Do not speak an answer in the old language while requesting the change. During registration, use propose_profile to reissue translated descriptive draft fields (interests, goals, activities, needs, intended entry term and notes) in the new language using only facts already supplied. Keep the stage field in its canonical schema value; the screen translates that value. Preserve personal names, school names, official titles, dates, numbers and uncertainty. Do not invent details or save merely because the language changed. An isolated name, college acronym, quoted form label or English term explained in Spanish is not a switch; neither is silence, noise or unclear audio. If the person explicitly requests a response language, follow that preference rather than the language of the request.</origen-language>`;
}

/** Conservative transcript signal; names, acronyms and isolated borrowed terms do not switch language. */
export function spokenLanguageFromText(text,current='en'){
 if(typeof text!=='string')return current;
 const normalized=text.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'');
 const requests=[...normalized.matchAll(/(?:speak|talk|answer|respond|continue)(?: to me)?(?: in)? (spanish|english)|(?:habla|hablar|responde|responder|continua|continuar)(?:me)?(?: en)? (espanol|ingles)|(?:in|en) (spanish|english|espanol|ingles)(?: please| por favor)/g)];
 if(requests.length){const match=requests.at(-1),value=match[1]||match[2]||match[3];return ['spanish','espanol'].includes(value)?'es':'en';}
 const words=normalized.replace(/["“][^"”]*["”]/g,'').match(/[a-z]+/g)||[];
 if(words.length<3)return current;
 const spanish=new Set('yo soy tengo tenemos tiene quiero queremos quiere necesito necesitamos necesita mi mis hija hijo estoy estamos esta estamos como puedo podemos puedes porque pero para sobre que cual donde ayuda estudiar gusta gustaria llamo anos'.split(' '));
 const english=new Set('i am have has want wants need needs my our daughter son we how can could would should what where which because but for about please help studying like years'.split(' '));
 const es=new Set(words.filter(word=>spanish.has(word))).size,en=new Set(words.filter(word=>english.has(word))).size;
 if(es>=2&&es>=en+2)return 'es';
 if(en>=2&&en>=es+2)return 'en';
 return current;
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
