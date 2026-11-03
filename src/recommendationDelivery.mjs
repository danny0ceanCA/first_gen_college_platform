const normal=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
// Intent comes from independently captured speech, never tool arguments.
export function recommendationSpeechIntent(text){
 const s=normal(text);
 if(/\b(no|do not|not (?:now|save|add|recommend|suggest)|later|stop|cancel|never|dont|don t|despues|luego|cancela|deten)\b/.test(s))return 'dismiss';
 if(/^(yes save (it|this)( please)?|yes add (it|this)( to my (plan|steps))?|si guardalo( por favor)?|si guarda (esto|este paso)|si agregalo( a mi plan)?)$/.test(s))return 'approve';
 if(/\b(save|add|guarda|guardar|agrega|agregar)\b/.test(s)&&/\b(step|action|this|it|paso|accion|esto)\b/.test(s))return 'prepare';
 if(/\b(next step|next action|what should i do|recommend a step|suggest a step|proximo paso|siguiente paso|que debo hacer|recomienda un paso)\b/.test(s))return 'select';
 return 'other';
}
export function recommendationSpeechRequest(text){
 if(recommendationSpeechIntent(text)!=='select')return null;
 const s=normal(text),insurance=/\b(insurance|waiver|ship|seguro|exencion)\b/.test(s),documents=/\b(document|documents|documento|documentos|letter|carta)\b/.test(s),office=/\b(office|oficina|contact|contactar)\b/.test(s);
 const process=insurance?'insurance_waiver':documents?'aid_documents':office?'office_contact':null;
 const goal=/\b(decision|status|pending|decision|estado|pendiente)\b/.test(s)?'check_decision':/\b(submit|submission|entregar|entrega|enviar)\b/.test(s)?'submit_document':/\b(prepare|preparing|preparar|preparando)\b/.test(s)?'prepare_document':office?'understand_requirement':null;
 return {goal,process};
}
export function recommendationReadback(value,language,spoken=true){
 const es=language==='es';
 return (es?'Revisa este próximo paso privado: ':'Review this private next step: ')+value.action+' '+value.explanation+' '+(es?'Guardaré exactamente esta acción y una referencia a su recomendación en tu plan. Puedes editarla después. Esto no indica que la completaste, no programa un seguimiento y no comparte información ni autoriza evaluación. ':'I will save this exact action and its recommendation reference in your plan. You can edit it afterward. This does not mark it complete, schedule a check-in, share information or authorize evaluation. ')+(spoken?(es?'Para guardar esta selección exacta, di: sí, guárdalo.':'To save this exact selection, say: yes, save it.'):'');
}
export function recommendationSaveDisclosure(language){return language==='es'?'Guardaré exactamente esta acción y una referencia a su recomendación en tu plan. Puedes editarla después. Esto no indica que la completaste, no programa un seguimiento y no comparte información ni autoriza evaluación.':'I will save this exact action and its recommendation reference in your plan. You can edit it afterward. This does not mark it complete, schedule a check-in, share information or authorize evaluation.';}
