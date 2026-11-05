type Input={mode:string;language?:string;role?:string;studentId?:string;routeConversations:boolean;targetConfirmed:boolean};
export function voicePreparationCandidates<T extends Input>(input:T,students:Array<{id:string;name:string}>):Array<Omit<T,'studentId'|'targetConfirmed'>&{studentId?:string;targetConfirmed:boolean}>;
