export type VoicePresenceState='ready'|'connecting'|'listening'|'user-speaking'|'thinking'|'speaking'|'muted'|'ending'|'blocked';
export function voicePresenceState(input:{state:string;activity:string;userSpeaking?:boolean;muted?:boolean;audioBlocked?:boolean;finishing?:boolean;researching?:boolean;switchingGuide?:boolean}):VoicePresenceState;
