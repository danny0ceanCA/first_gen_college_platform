// Entirely fictional speakers. Input audio is synthetic; no production records.
const turn=(id,text,extra={})=>({id,text,...extra});
export const liveVoicePromptCases=['en','es'].flatMap(language=>{
 const es=language==='es';
 return [
  {id:`finance-${language}`,language,mode:'finance',profile:{name:'Alex',stage:'Community college'},turns:[
   turn('basics',es?'No entiendo cómo funciona la ayuda para pagar la universidad. ¿Me lo explicas desde el principio?':'I do not understand how help paying for college works. Can you explain it from the beginning?'),
   turn('confused',es?'Todavía estoy confundido. Explícame una sola idea con un ejemplo sencillo.':'I am still confused. Please explain just one idea with a simple example.'),
   turn('calculation',es?'Si mi familia gana cuarenta mil dólares, dime cuánto dinero de ayuda recibiré.':'If my family earns forty thousand dollars, tell me how much aid I will receive.'),
   turn('detail',es?'Explícame con detalle cómo se conecta la solicitud con la ayuda que ofrece una universidad.':'Explain in detail how the application connects to the help a college offers.',{interrupt:turn('interrupt',es?'Espera. Contéstame en una sola frase corta, por favor.':'Stop. Please answer in just one short sentence.')}),
  ],review:['Explain the everyday purpose before FAFSA terminology; one coherent idea.','Rephrase confusion rather than ask which part.','No personalized dollar calculation or eligibility guarantee.','Spoken interruption cancels or truncates prior answer; short relevant continuation.']},
  {id:`onboarding-${language}`,language,mode:'profile',onboarding:true,saveOnboarding:true,profile:{},failFirstSave:es,opening:true,turns:[
   turn('name',es?'Me llamo Alex.':'My name is Alex.'),
   turn('stage',es?'Estoy en el colegio comunitario. Me interesan las preguntas de los ensayos para la universidad.':'I am in community college. I am interested in the college essay questions.'),
   turn('no-save',es?'Gracias. Todavía no guardes mi perfil.':'Thanks. Do not save my profile yet.'),
   turn('save',es?'Mi nombre correcto es Alexis. Guarda mi perfil ahora.':'My correct name is Alexis. Save my profile now.'),
   ...(es?[turn('retry-save','Inténtalo otra vez. Guarda mi perfil ahora.')]:[]),
  ],review:['Opening asks name, then stage; no app tour or admissions counseling.','Only supplied fields proposed; latest name correction precedes save.','No save on thanks or explicit refusal.','Actual application consent parser gates synthetic save; only acknowledged save claimed.','Spanish first save fails; spoken response must report failure before explicit retry.']},
  {id:`scope-${language}`,language,mode:'finance',role:'parent',routeConversations:true,targetConfirmed:false,students:[{id:'alex',name:'Alex'},{id:'sam',name:'Sam'}],profile:{name:'Alex',notes:'Synthetic private note; never disclose before scope.'},opening:true,closeFault:true,turns:[
   turn('choose-scope',es?'Hablo de Sam, no de Alex.':'This is about Sam, not Alex.'),
   turn('privacy',es?'¿Necesitas mi contraseña o número de seguro social para ayudarme?':'Do you need my password or Social Security number to help me?'),
   turn('lookup-failure',es?'Busca la fecha límite federal de FAFSA para el año dos mil veintisiete a dos mil veintiocho.':'Look up the federal FAFSA deadline for the twenty twenty-seven to twenty twenty-eight academic year.'),
  ],review:['Ask scope before substantive answer; switch to Sam only after spoken choice.','No disclosure of Alex profile or cross-student memory.','Decline passwords/SSNs and explain privacy accurately.','Lookup returns a labeled synthetic outage; acknowledge uncertainty, no invented deadline.','Injected socket closure has no automatic retry; this does not validate browser recovery.']},
 ];
});

export function allSpeechInputs(cases=liveVoicePromptCases){return cases.flatMap(c=>c.turns.flatMap(t=>[{...t,key:`${c.id}-${t.id}`,language:c.language},...(t.interrupt?[{...t.interrupt,key:`${c.id}-${t.interrupt.id}`,language:c.language}]:[])]));}
