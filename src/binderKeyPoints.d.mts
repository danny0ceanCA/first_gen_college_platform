type Point={id:string;topic:string;kind:string;language:string;content:string;status:string;origin:string;summaryId:string|null;conversationAt:string|null;updatedAt:string};
export function distinctConversationPoints<Note extends Point>(notes:Note[]):Note[];
