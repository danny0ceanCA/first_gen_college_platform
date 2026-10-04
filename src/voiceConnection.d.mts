import type {StudentProfile} from './planning';
export function voiceConnectionRecovery(disconnect:()=>void):{change:(state:string)=>void;stop:()=>void};
export function voiceProfile(mode:string,draft:StudentProfile,students:StudentProfile[],id:string|null):StudentProfile;
