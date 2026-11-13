import type {StudentProfile} from './planning';
export function voiceTransportProbe(pc:RTCPeerConnection,channel:{readyState:string}):()=>Promise<{mediaProgress:boolean;controlOpen:boolean}>;
export function voiceConnectionRecovery(disconnect:()=>void,options?:{probe?:()=>Promise<{mediaProgress:boolean;controlOpen:boolean}>;onEvent?:(details:Record<string,unknown>)=>void}):{change:(state:string)=>void;stop:()=>void};
export function voiceProfile(mode:string,draft:StudentProfile,students:StudentProfile[],id:string|null):StudentProfile;
