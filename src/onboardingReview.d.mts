type Draft={name:string;role:string;draft:{name:string;[key:string]:unknown}};
export function onboardingReview():{prepare:(value:Draft,stageAddressed:boolean)=>boolean;ready:(value:Draft)=>boolean;changed:(value:Draft)=>void;saved:()=>void};
