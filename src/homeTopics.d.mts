import type {ConversationMemory} from './ConversationHistory';
export type HomeTopicMode='planning'|'finance'|'admissions'|'loans';
export function homeTopicActivity(items:ConversationMemory[],studentId:string):{mode:HomeTopicMode;date:string}[];
