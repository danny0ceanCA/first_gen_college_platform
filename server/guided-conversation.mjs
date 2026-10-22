import {normalizeIntent,memoryIntent} from './live-memory-intent.mjs';
export const guidedConversationEnabled=env=>env.ORIGEN_GUIDED_CONVERSATION==='true';
export async function assertGuidedConversationReady(database,env){
 if(!guidedConversationEnabled(env))return;
 if(env.ORIGEN_BINDER_CORRECTIONS!=='true'||!database||(await database.query("SELECT name FROM origen_schema_migrations WHERE name IN ('063_binder_corrections.sql','064_guided_conversation.sql')")).rows.length!==2)throw new Error('guided_conversation_configuration_required');
}
const days=/\b((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|weekends?|weekdays?|every day|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|fines de semana|todos los dias)\b/;
const work=/\b(work|working|job|trabajo|trabaja|trabajar|empleo)\b/;
const term=/\b(fall|spring|summer|autumn|otono|primavera|verano|20\d{2})\b/;
export const guidanceQuestions={
 work_days:{topic:'transfer',en:'Which days do you work? You can skip this if you prefer.',es:'¿Qué días trabajas? Puedes saltarte esta pregunta si prefieres.',reason:'Working days affect which class schedules may fit.'},
 aid_progress:{topic:'costs',en:'Have you started a financial aid application, or would you like to start from the beginning? You can skip this.',es:'¿Ya empezaste una solicitud de ayuda financiera o prefieres empezar desde el principio? Puedes saltarte esta pregunta.',reason:'The next useful aid step depends on where the person is starting.'},
 entry_term:{topic:'applications',en:'When would you like to start college? It is okay if you are not sure yet.',es:'¿Cuándo te gustaría empezar la universidad? Está bien si aún no sabes.',reason:'An intended start term is needed before discussing a specific application cycle.'},
 interests:{topic:'options',en:'What subjects or activities interest you? It is okay if you are still exploring.',es:'¿Qué materias o actividades te interesan? Está bien si todavía estás explorando.',reason:'Personal interests can make an options comparison useful without inventing a commitment.'},
};
export const declinedQuestion=text=>/\b(skip|rather not|prefer not|don t want to (?:say|answer|share)|not comfortable|no quiero (?:decir|responder|compartir)|prefiero no|saltar|saltala|pasemos|no se|not sure|don t know)\b/.test(normalizeIntent(text));
const answered=(key,text)=>key==='work_days'?days.test(normalizeIntent(text)):key==='entry_term'?term.test(normalizeIntent(text)):key==='aid_progress'?/\b(started|submitted|finished|not yet|haven t|beginning|empece|empezado|enviado|termine|todavia no|aun no|principio)\b/.test(normalizeIntent(text)):/\b(like|interested|enjoy|gusta|interesa)\b/.test(normalizeIntent(text));
// This policy only chooses a question. It never turns an answer into a fact or
// commitment, and it does not inspect unrelated students or send data to a model.
export function chooseGuidanceQuestion({topic,transcript,profile={},memories=[],notes=[],held=[]}){
 const spoken=normalizeIntent(transcript),facts=[...memories,...notes].filter(x=>x.category!=='question'&&x.kind!=='question').map(x=>normalizeIntent(x.content));
 facts.push(...[profile.needs,profile.goals,profile.interest].filter(s=>typeof s==='string').map(normalizeIntent));
 const uncertain=s=>/\b(maybe|might|perhaps|not sure|tal vez|quiza|quizas|posiblemente|no se)\b/.test(s);
 const aid=/\b(fafsa|cadaa|financial aid|ayuda financiera)\b/;
 const start=/\b(start|starting|enter|enroll|begin|college|empezar|empiezo|ingresar|universidad)\b/;
 let key;
 if(topic==='transfer'&&/\b(classes|courses|schedule|clases|cursos|horario)\b/.test(spoken)&&[...facts,spoken].some(s=>work.test(s))&&!facts.some(s=>work.test(s)&&days.test(s)&&!uncertain(s))&&!(work.test(spoken)&&days.test(spoken)&&!uncertain(spoken)))key='work_days';
 if(topic==='costs'&&aid.test(spoken)&&!facts.some(s=>aid.test(s)&&answered('aid_progress',s))&&!answered('aid_progress',spoken))key='aid_progress';
 if(topic==='applications'&&/\b(apply|application|deadline|solicitud|solicitudes|fecha limite|postular)\b/.test(spoken)&&!profile.entryTerm?.trim()&&!facts.some(s=>start.test(s)&&term.test(s))&&!term.test(spoken))key='entry_term';
 if(topic==='options'&&/\b(which college|choose a college|what should i study|which major|que (?:deberia|puedo) estudiar|elegir (?:una )?universidad|que carrera)\b/.test(spoken)&&!profile.interest?.trim()&&!profile.goals?.trim()&&!memories.some(m=>m.category==='goal')&&!facts.some(s=>answered('interests',s)))key='interests';
 return key&&!held.includes(key)?key:null;
}
export async function guidanceTurn(c,owner,session,input){
 if(!input.transcript.trim()||session.gap_turn!==input.sequence-1||!session.gap_presented)return;
 const status=declinedQuestion(input.transcript)?'declined':answered(session.gap_key,input.transcript)?'answered':null;
 if(status)await c.query('UPDATE origen_guidance_questions SET status=$4,updated_at=now(),expires_at=now()+interval \'7 days\' WHERE account_id=$1 AND scope_key=$2 AND question_key=$3',[owner,session.student_id??'',session.gap_key,status]);
}
export async function guidanceAction(c,owner,session,input){
 const language=session.turn_language==='es'?'es':'en';
 if(input.action==='question-present'){
  const question=guidanceQuestions[session.gap_key];
  const valid=question&&session.gap_turn===input.sequence&&input.key===session.gap_key&&normalizeIntent(input.presentation).includes(normalizeIntent(question[language]));
  if(valid){
   await c.query("INSERT INTO origen_guidance_questions(account_id,scope_key,student_id,question_key,status) VALUES($1,$2,$3,$4,'asked') ON CONFLICT(account_id,scope_key,question_key) DO UPDATE SET status='asked',updated_at=now(),expires_at=now()+interval '7 days'",[owner,session.student_id??'',session.student_id,session.gap_key]);
   await c.query('UPDATE origen_live_memory_sessions SET gap_presented=true WHERE account_id=$1 AND id=$2',[owner,session.id]);
  }
  return {status:valid?'presented':'not_presented'};
 }
 if(session.gap_turn===input.sequence){
  const q=guidanceQuestions[session.gap_key];
  return session.gap_presented?{status:'no_question',instruction:'This question was already asked. Continue without repeating it.'}:{status:'question',key:session.gap_key,question:q[language],reason:q.reason,instruction:'Ask exactly this one question only if it still helps the current request. Allow skipping. Do not save its answer as confirmed information.'};
 }
 await c.query('DELETE FROM origen_guidance_questions WHERE account_id=$1 AND expires_at<=now()',[owner]);
 const held=(await c.query('SELECT question_key FROM origen_guidance_questions WHERE account_id=$1 AND scope_key=$2',[owner,session.student_id??''])).rows.map(r=>r.question_key);
 // Match the family repository's effective linked profile while keeping needs
 // private to this account. The existing scoped function owns link permission.
 const shared=c.isolated?'LEFT JOIN LATERAL origen_shared_profile(m.id) s ON true':'LEFT JOIN origen_student_links l ON l.member_account_id=m.account_id AND l.member_student_id=m.id LEFT JOIN origen_students s ON s.account_id=l.owner_account_id AND s.id=l.owner_student_id';
 const profile=session.student_id===null?{}:(await c.query(`SELECT coalesce(s.interest,m.interest) AS interest,coalesce(s.goals,m.goals) AS goals,coalesce(s.entry_term,m.entry_term) AS "entryTerm",m.needs FROM origen_students m ${shared} WHERE m.account_id=$1 AND m.id=$2`,[owner,session.student_id])).rows[0];
 const records=(await c.query("SELECT m.content,m.category FROM origen_student_memories m WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2 AND status IN ('proposed','confirmed') AND (status='confirmed' OR context_current OR NOT EXISTS(SELECT 1 FROM origen_memory_batches b WHERE b.account_id=m.account_id AND b.summary_id=m.source_summary_id AND b.suppressed))",[owner,session.student_id])).rows;
 const notes=(await c.query("SELECT n.content,n.kind FROM origen_topic_notes n WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2 AND (context_current OR NOT EXISTS(SELECT 1 FROM origen_memory_batches b WHERE b.account_id=n.account_id AND b.summary_id=n.source_summary_id AND b.suppressed)) ORDER BY updated_at DESC LIMIT 120",[owner,session.student_id])).rows;
 const key=chooseGuidanceQuestion({topic:input.topic,transcript:input.transcript,profile,memories:records,notes,held});
 if(!key)return {status:'no_question',instruction:'No supported missing detail warrants a question now. Use the information already supplied; respect skipped questions. Answer helpfully without an intake checklist or invented facts.'};
 await c.query('UPDATE origen_live_memory_sessions SET gap_key=$3,gap_turn=$4,gap_presented=false WHERE account_id=$1 AND id=$2',[owner,session.id,key,input.sequence]);
 return {status:'question',key,question:guidanceQuestions[key][language],reason:guidanceQuestions[key].reason,instruction:'Ask exactly this one question only if it still helps the current request. Allow skipping. Do not save its answer as confirmed information.'};
}
export function spokenCorrectionIntent(transcript,change,old){
 const spoken=normalizeIntent(transcript),content=normalizeIntent(change.content);
 if(/^(no|not|dont|don t|never|nunca)\b/.test(spoken))return 'not_requested';
 const ordinary=memoryIntent(transcript,change,old?.content);
 if(change.kind==='delete')return ordinary==='not_requested'?'not_requested':'clarify';
 if(!content)return 'not_requested';
 if(ordinary==='authorized')return old?.kind==='decision'?'clarify':'authorized';
 // Match the whole replacement clause, not a substring that could lose
 // "maybe", "only", a negation, or another important qualifier.
 const correction=!/[?¿]/.test(transcript)&&spoken.match(/^(?:actually|correction|i meant|en realidad|quise decir|me equivoque) (.+)$/);
 const command=spoken.replace(/^(?:please|por favor) /,'').match(/^(?:change|update|correct|cambia|actualiza|corrige) .+? (?:to|a) (.+)$/);
 if(correction&&correction[1]===content||command&&command[1]===content)return 'clarify';
 return 'not_requested';
}
export const guidedConversationTools=[
 {type:'function',name:'get_guidance_question',description:'Check whether one missing detail would materially improve this answer. Server checks current topic, existing context and recently asked/declined questions. Never use as an intake checklist.',parameters:{type:'object',additionalProperties:false,properties:{topic:{type:'string',enum:['options','transfer','costs','applications']}},required:['topic']}},
 {type:'function',name:'correct_binder_item',description:'Correct or remove one existing memory or topic note after an explicit spoken correction. Recall first for its exact ID/version and old text. Preserve exact replacement wording and uncertainty. Never create a duplicate. Ambiguous changes and all removals need a fully delivered readback and spoken confirmation.',parameters:{type:'object',additionalProperties:false,properties:{store:{type:'string',enum:['memory','note']},kind:{type:'string',enum:['update','delete']},id:{type:'string'},version:{type:'integer',minimum:1},content:{type:'string'}},required:['store','kind','id','version','content']}},
];
export const guidedConversationInstructions=' GUIDED CONVERSATION: Keep this a useful conversation, not an intake form. Answer what can be answered first. When one missing detail would materially change advice, call get_guidance_question for the current spoken topic. Follow no_question, known context and declined/unknown answers; never keep requesting a skipped detail. Ask at most one question at a time and allow skipping without loss of help. A question answer is conversation context, not permission for a durable write; the existing saved-summary organization handles it later as unreviewed evidence. Never turn maybe into a decision. To persist an explicit correction such as Actually, I work Tuesdays and Thursdays, recall the exact existing item, then use correct_binder_item with the exact spoken replacement. These tools supersede instructions to use only screen controls for memory/topic-note corrections. Profile fields, action plans and sharing still use their existing controls. Ambiguous targets must be resolved, never guessed. For clarification_required, read the exact old and new text and ask whether to save the change (or delete the old text). Wait for a fully delivered question and an explicit yes; interruptions, silence and agreement with advice are not consent. Do not claim success until saved. A confirmed change refreshes the call; do not perform a second write or claim that undo/sharing was restored.';
