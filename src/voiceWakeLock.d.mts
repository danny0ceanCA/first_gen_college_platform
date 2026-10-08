export type VoiceWakeLockStatus='active'|'unavailable'|'hidden';
export function voiceWakeLock(onStatus?:(status:VoiceWakeLockStatus)=>void):{stop:()=>void};
