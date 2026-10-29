const words=text=>[...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
const normalize=text=>words(text).map(w=>w[0].toLowerCase().replaceAll('’',"'")).join(' ');
// This proves only that supplied teaching wording appeared in output, not that
// every claim is correct or that a person heard, understood, or agreed with it.
export function createTeachingEvidence(){
 const entries=new Map(),matches=new Map();let transcript='',characters=0,audioChunks=0,playbackReported=false,readyAt=null;
 return {
  supplied(values){for(const entry of values)entries.set(entry.id+':'+entry.revision,entry);},
  ready(){readyAt??=new Date().toISOString();},
  audio(){audioChunks++;},
  playback(){playbackReported=true;},
  transcript(delta){
   if(typeof delta!=='string')return;characters+=delta.length;transcript=(transcript+delta).slice(-16000);const spoken=' '+normalize(transcript)+' ';
   for(const [key,entry] of entries){
    if(matches.has(key))continue;
    const text=entry.content.explanation||'',tokens=words(text);
    for(let i=0;i+8<=tokens.length;i++){
     const end=tokens[i+7],quote=text.slice(tokens[i].index,end.index+end[0].length);
     if(quote.length<35||!spoken.includes(' '+normalize(quote)+' '))continue;
     matches.set(key,{id:entry.id,revision:entry.revision,title:entry.content.title,quote,observedAt:new Date().toISOString(),evidence:'spoken_transcript_wording'});break;
    }
   }
  },
  snapshot(){return {readyAt,outputTranscriptCharacters:characters,providerAudioChunks:audioChunks,browserPlaybackReported:playbackReported,matches:[...matches.values()]};},
 };
}
