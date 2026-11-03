export type ActionTemplate={version:1;mode:'general_question'|'institution_requirement';action:{en:string;es:string};explanation:{en:string;es:string};goal:string;process:string;prerequisites:string[];exclusions:string[];campus:null|{name:string;officialHost:string};term:string|null;sources:{id:string;url:string;claim:{en:string;es:string};checkedOn:string;reviewBy:string}[];reviewedOn:string;reviewBy:string};
export const actionGoals:readonly string[];
export const actionProcesses:readonly string[];
export const actionPrerequisites:readonly string[];
export const actionExclusions:readonly string[];
export function officialHost(value:unknown):boolean;
export function validateActionTemplate(value:unknown):ActionTemplate;
export function actionTemplateDrafts(day?:string):{key:string;title:string;content:ActionTemplate}[];
