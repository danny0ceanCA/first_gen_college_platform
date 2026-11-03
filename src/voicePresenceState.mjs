// Display priority follows the call, including interruptions and muted input.
export function voicePresenceState({state,activity,userSpeaking=false,muted=false,audioBlocked=false,finishing=false,researching=false,switchingGuide=false}){
 if(finishing)return 'ending';
 if(state==='connecting')return 'connecting';
 if(state!=='live')return 'ready';
 if(audioBlocked)return 'blocked';
 if(userSpeaking&&!muted)return 'user-speaking';
 if(activity==='speaking')return 'speaking';
 if(researching||switchingGuide||activity==='thinking')return 'thinking';
 return muted?'muted':'listening';
}
