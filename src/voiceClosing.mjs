import {collegeVoiceStyle} from './voiceStyle.mjs';

// Only unambiguous, complete closing turns. A bare thanks, a quoted goodbye,
// or a thanks followed by another question must leave the conversation open.
export function isVoiceGoodbye(text){
 const value=String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/’/g,"'").replace(/[.!¡,;:]+/g,' ').replace(/\s+/g,' ').trim();
 if(/[?¿"“”]/.test(value))return false;
 return /^(?:(?:ok(?:ay)?|great|perfect|thank you(?: very much)?|thanks(?: so much)?|muchas gracias|gracias|perfecto|bien)[\s]*)*(?:goodbye|bye(?: bye)?|see you(?: later)?|talk to you later|that(?:'s| is) all(?: for (?:now|today))?|i(?:'m| am) (?:all )?done(?: for (?:now|today))?|adios|hasta (?:luego|pronto|la proxima)|eso es todo(?: por (?:ahora|hoy))?|ya terminamos|terminar (?:la )?(?:llamada|conversacion)|end (?:the |this )?(?:call|conversation))(?:(?: and)? (?:thanks|thank you|gracias|muchas gracias|goodbye|bye|adios|hasta luego))*$/.test(value);
}

// The model may recognize a contextual conclusion outside the short fast path,
// but it must not hang up on courtesy alone or a new question.
export function canEndVoiceConversation(text){
 const value=String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
 if(!value||/[?¿"“”]/.test(value)||/\b(?:don['’]?t|do not|not done|no termines|no hemos terminado)\b/.test(value))return false;
 if(/^(?:ok(?:ay)?[,.! ]*)?(?:thanks(?: so much)?|thank you(?: very much| so much)?|(?:muchas )?gracias)(?:[,.! ]*(?:origen|for (?:your |the )?help|por (?:tu |la )?ayuda))?[.! ]*$/.test(value))return false;
 return /\b(?:goodbye|bye|done|that['’]?s (?:all|everything)|that is (?:all|everything)|all i (?:need|needed)|covers (?:it|everything)|end (?:the |this )?(?:call|conversation)|have to go|got to go|adios|hasta (?:luego|pronto|la proxima)|eso es todo|terminamos|terminar (?:la )?(?:llamada|conversacion)|tengo que irme|ya es suficiente)\b/.test(value);
}

export function voiceFarewell(language){
 return `${collegeVoiceStyle} The person has ended this call. Say only one brief, warm farewell in ${language==='es'?'Spanish: "Gracias por conversar conmigo. ¡Hasta luego!"':'English: "Thanks for talking with me. Take care!"'}. Do not greet, ask a question, offer more help, or claim that anything was saved.`;
}

// Own the final response independently of normal turn scheduling. Generation
// completing is NOT playback completing: WebRTC drains in a separate event.
export function voiceClosing({send,stopInput,stopWork,disconnect,language=()=> 'en',schedule=setTimeout,cancel=clearTimeout,timeout=18000}){
 let closing=false,finished=false,responseId,generated=false,drained=false,timer,farewellEvent;
 const finish=reason=>{if(finished)return;finished=true;if(timer)cancel(timer);disconnect(reason);};
 return {
  active:()=>closing,
  begin(instructions){
   if(closing||finished)return;
   closing=true;
   try{
    stopInput();stopWork();
    timer=schedule(()=>finish('timeout'),instructions?Math.max(timeout,45000):timeout);
    send({type:'response.cancel'});
    send({type:'output_audio_buffer.clear'});
    send({type:'input_audio_buffer.clear'});
    // An out-of-conversation response cannot run tools or revive a normal reply.
    farewellEvent=globalThis.crypto.randomUUID();
    send({type:'response.create',event_id:farewellEvent,response:{conversation:'none',metadata:{topic:'origen_farewell'},input:[],output_modalities:['audio'],tools:[],tool_choice:'none',instructions:instructions||voiceFarewell(language())}});
   }catch{finish('unavailable');}
  },
  event(event){
   if(!closing||finished)return;
   if(event.type==='response.created'&&event.response?.metadata?.topic==='origen_farewell')responseId=event.response.id;
   if(event.type==='error'){
    // Late errors from cancelled normal work cannot cut off the farewell.
    if(event.error?.event_id===farewellEvent||['session_expired','session_closed','invalid_api_key'].includes(event.error?.code))finish('error');
    return;
   }
   if(!responseId)return;
   if(event.type==='response.done'&&event.response?.id===responseId){
    if(event.response.status!=='completed'){finish('cancelled');return;}
    if(Array.isArray(event.response.output)&&!event.response.output.some(item=>item.content?.some(part=>part.type==='audio'||part.type==='output_audio'))){finish('no_audio');return;}
    generated=true;
   }
   if(event.type==='output_audio_buffer.stopped'&&event.response_id===responseId)drained=true;
   if(event.type==='output_audio_buffer.cleared'&&event.response_id===responseId){finish('cancelled');return;}
   if(generated&&drained)finish('drained');
  },
  // Privacy, unmount and transport failures never wait for a farewell.
  force(){if(closing)finish('forced');},
  stop(){finished=true;if(timer)cancel(timer);},
 };
}
