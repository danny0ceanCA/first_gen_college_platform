import {authConfig} from './authConfig';
export type Student={id:string;name:string;stage:string;interests:string;goals:string;gpa?:string;color?:string;institutions?:string;entryTerm?:string;school?:string;activities?:string;needs?:string;notes?:string};
export type Account={firstName:string;email:string};
export type Family={account:Account;students:Student[]};
export const stages=['','9th grade','10th grade','11th grade','12th grade','Community college','College'];
export function toServer(student:Student){
 const {interests,...rest}=student;
 const stage=stages.includes(student.stage)?student.stage:'';
 return {...rest,stage,interest:interests,gpa:student.gpa||'',color:student.color||'peach',notes:stage===student.stage?student.notes||'':[student.notes,`Education stage shared: ${student.stage}`].filter(Boolean).join('; ')};
}
export async function familyRequest(getToken:()=>Promise<string>,operation:Record<string,unknown>,signal?:AbortSignal):Promise<Family>{
 const token=await getToken();
 const response=await fetch(`${authConfig.apiUrl.replace(/\/$/,'')}/api/family`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(operation),signal});
 const result=await response.json();
 if(!response.ok||!result.account||!Array.isArray(result.students))throw new Error('Family could not be saved or loaded.');
 return {account:result.account,students:result.students.map((s:Student&{interest:string})=>{const {interest,...rest}=s;return {...rest,interests:interest};})};
}
