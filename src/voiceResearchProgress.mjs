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
   if(elapsed>=[10000,35000][count]){
    const sentence=messages[language()==='es'?'es':'en'][spoken];
    if(speak(sentence)){spoken++;count++;onProgress(elapsed);}
   }
   if(count<2&&spoken<3)timer=schedule(tick,1000);
  };
  timer=schedule(tick,10000);
 }};
}

export function researchEvidence(result,reused){
 return {text:result.text,sources:result.sources,checkedAt:result.checkedAt,
  status:reused?'reused_verified_result':'source_check_completed',
  instruction:reused?'This result was reused from this call. Do not claim a new search or fresh verification. Explain the relevant evidence, preserving its scope, date and uncertainty.':'The source check returned. Explain only what the evidence supports, preserving scope, date and uncertainty. Links are shown in the app; do not read URLs aloud.'};
}
