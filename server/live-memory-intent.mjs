// The transcript comes from the client transcription path, independently of
// model tool arguments. Normalize punctuation/case, never paraphrase a write.
export const normalizeIntent=value=>String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const polite=value=>normalizeIntent(value).replace(/^(please |por favor )/,'').replace(/^(can you |could you |would you |puedes |podrias )/,'').replace(/ (please|por favor)$/,'');
export const acceptsProposal=value=>/^(yes|yes please|yes save it|yes save that|save it|save that|si|si por favor|si guardalo|si guarda eso|guardalo|guarda eso)$/.test(polite(value));
export function memoryIntent(transcript,change,oldContent){
 const spoken=polite(transcript),content=normalizeIntent(change.content),old=normalizeIntent(oldContent);
 if(!spoken||/^(no|not|dont|don t|never|nunca)\b/.test(spoken))return 'not_requested';
 const direct=(patterns,expected)=>patterns.some(pattern=>{const match=spoken.match(pattern);return match&&match[1]===expected;});
 if(['create','next-step'].includes(change.kind)&&/^(it|that|this|eso|esto|lo)$/.test(content))return 'clarify';
 if(change.kind==='create'&&direct([/^(?:remember|save)(?: that| this detail| this memory)? (.+)$/,/^(?:recuerda|guarda)(?: que| este dato| este recuerdo)? (.+)$/],content))return 'authorized';
 if(change.kind==='next-step'&&direct([/^add (.+) to my next steps$/,/^save (.+) as (?:my |a )?next step$/,/^(?:guarda|agrega|anade) (.+) como (?:mi |un )?(?:proximo paso|siguiente paso)$/],content))return 'authorized';
 if(change.kind==='delete'&&old&&direct([/^(?:forget|remove|delete)(?: the memory| that)? (.+)$/,/^(?:olvida|borra|elimina)(?: el recuerdo| que)? (.+)$/],old))return 'authorized';
 if(change.kind==='update'&&old){
  if([`change ${old} to ${content}`,`update ${old} to ${content}`,`cambia ${old} a ${content}`,`actualiza ${old} a ${content}`].includes(spoken))return 'authorized';
 }
 // Ambiguous referents/rewrites need one confirmation bound to this exact
 // request. Plain conversation, questions and negated requests cannot prepare it.
 if(/^(remember|save|update|change|correct|forget|remove|delete|add|recuerda|guarda|actualiza|cambia|corrige|olvida|borra|elimina|agrega|anade)\b/.test(spoken)||/\b(?:please (?:save|update|correct|change) (?:it|that|this)|por favor (?:actualiza|guarda|corrige) (?:eso|esto))$/.test(spoken)||acceptsProposal(spoken))return 'clarify';
 return 'not_requested';
}
