export function studentLivePlayback(options?:Record<string,unknown>):{prime:()=>Promise<void>;attach:(stream:MediaStream)=>Promise<void>;idle:()=>boolean;stop:()=>void};
