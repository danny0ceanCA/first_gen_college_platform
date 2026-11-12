import {researchBriefSelection} from './researchBrief.mjs';
const messages={
 en:["I'm checking the official sources for that.","This is taking a little longer. You can keep talking while I check.","I'm waiting for the source check to finish."],
 es:['Estoy consultando las fuentes oficiales para eso.','Está tardando un poco más. Puedes seguir hablando mientras consulto.','Estoy esperando que termine la consulta de las fuentes.'],
};

// One instance per physical call. Only start after an uncached request is sent.
export function voiceResearchProgress({speak,language=()=> 'en',isCurrent=()=>true,onProgress=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
 let timer,revision=0,spoken=0;
 const stop=()=>{revision++;if(timer!==undefined)cancel(timer);timer=undefined;};
 return {stop,start(){
  stop();if(spoken>=3)return;
  const version=revision,started=now();let count=0;
  const tick=()=>{
   timer=undefined;
   if(version!==revision||!isCurrent())return;
   const elapsed=now()-started;
   if(elapsed>=[4000,25000][count]){
    const sentence=messages[language()==='es'?'es':'en'][spoken];
    if(speak(sentence)){spoken++;count++;onProgress(elapsed);}
   }
   if(count<2&&spoken<3)timer=schedule(tick,1000);
  };
  timer=schedule(tick,4000);
 }};
}

export function researchEvidence(result,reused){
 return {...researchBriefSelection(result),
  status:reused?'reused_verified_result':'source_check_completed',
  instruction:(reused?'This result came from a retained source report. Do not claim a new search or fresh verification.':'The source check returned. Links are shown in the app; do not read URLs aloud.')+' Explain only what the evidence supports. Use the cited findings with their scope, date and uncertainty. If the requested total is unverified, say so and give any supported subtotal with its scope. Never substitute a remembered amount, a different scenario, or an invented total. Preserve the source classification of billed charges versus estimated allowances. Campus residence-hall housing and meal plans may be billed by the university; do not label them indirect merely because they are living costs. Off-campus housing estimates are not automatically university charges. A cost-of-attendance budget is not a bill or a personalized aid calculation. If billing classification is not verified, say it is unknown. The person may have spoken while the search ran. Address their latest question or clarification first; use this evidence only where relevant, and never treat an answer to the earlier question as a complete answer to a changed request.'};
}
