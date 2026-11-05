export function summarizeLiveAudioStats(report:RTCStatsReport,previous?:Map<string,Record<string,number>>):{summary:Record<string,unknown>;previous:Map<string,Record<string,number>>};
export function startLiveAudioDiagnostics(options?:{
 pc?:RTCPeerConnection;audio?:HTMLAudioElement|null;enabled?:boolean;onEvent?:(event:string,details:Record<string,unknown>)=>void;getAudioContextState?:()=>string|undefined;document?:Document;clock?:()=>number;schedule?:typeof setTimeout;cancel?:typeof clearTimeout;intervalMs?:number;maxSamples?:number;maxEvents?:number;
}):{stop:()=>void;sample:()=>Promise<void>};
