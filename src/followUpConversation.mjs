const normalize=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
export function followUpIntent(value){
 const text=normalize(value).replace(/^(please |por favor )/,'').replace(/^(can you |could you |would you |i want you to |i would like you to |puedes |podrias |quiero que )/,'').replace(/^(please |por favor )/,'');
 if(/^(stop|cancel|turn off|deten|detener|cancela|cancelar|desactiva) (all (my )?(check ins|check-ins|follow ups|follow-ups)|todos (mis |los )?(seguimientos|recordatorios))\b/.test(text))return 'stop-all';
 if(/^(stop (checking in|following up|reminding me)|don t remind me|do not remind me|don t bring this up again|do not bring this up again|deja de (recordarme|preguntarme)|no me preguntes de nuevo)\b/.test(text))return 'stop';
 if(/^(stop|cancel|turn off|deten|detener|cancela|cancelar|desactiva) (this |my |the |este |mi |el )?(check in|check-in|follow up|follow-up|seguimiento|recordatorio)\b/.test(text)||/^(don t|do not) (check in|follow up)\b/.test(text)||/^no (me recuerdes|retomes|hagas seguimiento)\b/.test(text))return 'stop';
 if(/\b(don t|do not|never|not yet|never mind|no guardes|no programes|todavia no|aun no|olvidalo)\b/.test(text))return 'none';
 if(/^(check in|follow up|remind me|reschedule|move (my |this |the )?(check in|check-in)|retoma|retomemos|recuerdame|reprograma|preguntame|hazme seguimiento)\b/.test(text))return 'check-in';
 if(/^(save|record|update|correct|replace|guarda|guardar|registra|registrar|actualiza|corrige|reemplaza)\b/.test(text)&&/\b(update|progress|what happened|report|actualizacion|avance|lo que paso|informe)\b/.test(text))return 'report';
 return 'none';
}
export const approvesFollowUp=value=>/^(yes save it|yes save this|save this private update|save this check in|confirm my check in|si guardalo|si guarda esto|guarda esta actualizacion privada|confirma mi seguimiento)$/.test(normalize(value).replaceAll('-',' '));
export function followUpSchedule(text,timeZone,now=new Date()){
 let local;try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);local=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');}catch{return null;}
 const s=normalize(text),dates=String(text).match(/\b\d{4}-\d{2}-\d{2}\b/g)||[];
 const next=/\b(next time|next conversation|proxima vez|proxima conversacion)\b/.test(s),tomorrow=/\b(tomorrow|manana)\b/.test(s);
 // Weekdays, next week, and mixed alternatives need a concrete calendar date.
 if(/\b(next week|next month|proxima semana|proximo mes|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(s))return null;
 const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12};
 const en=s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)? (\d{4})\b/);
 const es=s.match(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) (?:de |del )?(\d{4})\b/);
 if(en)dates.push(`${en[3]}-${String(months[en[1]]).padStart(2,'0')}-${en[2].padStart(2,'0')}`);
 if(es)dates.push(`${es[3]}-${String(months[es[2]]).padStart(2,'0')}-${es[1].padStart(2,'0')}`);
 if(Number(next)+Number(tomorrow)+dates.length!==1)return null;
 if(next)return {onOrAfter:null,timeZone};
 let day=dates[0];if(tomorrow){const date=new Date(`${local}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+1);day=date.toISOString().slice(0,10);}
 if(!day||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day<local)return null;
 return {onOrAfter:day,timeZone};
}
export const reportLabels={
 en:{answered:'I chose to record an update',declined:'I chose not to answer',unknown:'I do not know yet',not_started:'not started',attempted:'attempted',completed:'completed',changed_course:'changed course',pending:'pending',resolved:'resolved',unresolved:'unresolved',helpful:'helpful',partly_helpful:'partly helpful',not_helpful:'not helpful','not-started':'not started','in-progress':'in progress',complete:'complete',deferred:'set aside'},
 es:{answered:'Elegí registrar una actualización',declined:'Elegí no responder',unknown:'Aún no lo sé',not_started:'sin comenzar',attempted:'intentada',completed:'completada',changed_course:'cambié de rumbo',pending:'pendiente',resolved:'resuelto',unresolved:'sin resolver',helpful:'útil',partly_helpful:'algo útil',not_helpful:'no fue útil','not-started':'sin comenzar','in-progress':'en progreso',complete:'completada',deferred:'en pausa'},
};
const dateLabel=(day,language)=>day?new Intl.DateTimeFormat(language==='es'?'es-US':'en-US',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`)):null;
export function checkInReadback(preview,language){
 const es=language==='es',schedule=preview.payload.enrollment.selection.schedule;
 const when=schedule.onOrAfter?(es?`cuando vuelvas a hablar conmigo a partir del ${dateLabel(schedule.onOrAfter,language)}`:`when you next talk with me on or after ${dateLabel(schedule.onOrAfter,language)}`):(es?'la próxima vez que hablemos':'the next time we talk');
 return es?`Quieres un solo seguimiento sobre: ${preview.action.title}. La acción es: ${preview.action.content}. Será ${when}, en la zona horaria ${schedule.timeZone}. No cambiará tu fecha meta. Es privado y no avisa a tu coordinador. No te llamaré ni enviaré recordatorios fuera de una conversación que tú inicies. Para guardarlo, di: sí, guárdalo.`:`You want one check-in about: ${preview.action.title}. The action is: ${preview.action.content}. It will be ${when}, in the ${schedule.timeZone} time zone. Your target date stays the same. This is private and does not notify your coordinator. I will not call or send reminders outside a conversation you start. To save it, say: yes, save it.`;
}
export function privateUpdateReadback(preview,language,spoken=true){
 const es=language==='es',p=preview.payload,r=p.report,labels=reportLabels[es?'es':'en'],label=v=>labels[v]||v;
 const facts=r.responseState==='answered'?(es?`Acción que reportas: ${label(r.reportedAction)}. Resultado que reportas: ${label(r.reportedOutcome)}. Tus palabras: ${r.detail||'Sin detalle adicional'}.`:`Action you report: ${label(r.reportedAction)}. Outcome you report: ${label(r.reportedOutcome)}. Your words: ${r.detail||'No additional detail'}.`):label(r.responseState)+'.';
 const date=r.occurredOn?dateLabel(r.occurredOn,language):(es?'sin fecha indicada':'no date specified');
 const helpfulness=r.helpfulness===null?(es?'no registrada': 'not recorded'):label(r.helpfulness);
 const plan=p.planStatus===null?(es?'El progreso de tu acción no cambiará.': 'Your action progress will not change.'):(es?`El progreso de esta acción cambiará a: ${label(p.planStatus)}.`:`This action’s progress will change to: ${label(p.planStatus)}.`);
 return es?`Revisa esta actualización privada para: ${preview.action.title}. ${p.reportId?'Reemplazará la actualización anterior. ':''}${facts} Fecha de lo ocurrido: ${date}. Zona horaria: ${r.timeZone}. Utilidad que reportas: ${helpfulness}. ${plan} Esto es lo que tú reportas; no está verificado por la institución y no demuestra que el consejo causó el resultado. No se comparte con tu coordinador. ${spoken?'Para guardar este texto exacto, di: sí, guárdalo.':''}`:`Review this private update for: ${preview.action.title}. ${p.reportId?'It replaces the earlier update. ':''}${facts} Date it happened: ${date}. Time zone: ${r.timeZone}. Helpfulness you report: ${helpfulness}. ${plan} This is student-reported, not verified by the institution, and does not establish that the advice caused the outcome. It is not shared with your coordinator. ${spoken?'To save this exact wording, say: yes, save it.':''}`;
}
