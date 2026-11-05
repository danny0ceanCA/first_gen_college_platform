export function voiceInitialScope():{
 select:(studentId:string|null,load:(isCurrent:()=>boolean)=>Promise<boolean|undefined>)=>Promise<{accepted:boolean;superseded:boolean}>;
 stop:()=>void;
};
