import {createContext,useContext,type ReactNode} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {GuidancePanel,useGuidanceRequest,type Guidance} from './CoordinatorGuidance';
import type {ActionSeed} from './ActionPlan';

export type StudentCommentsState={items:Guidance[];ready:boolean;render:(items:Guidance[])=>ReactNode;status:ReactNode};
const empty:StudentCommentsState={items:[],ready:false,render:()=>null,status:null};
const Comments=createContext<StudentCommentsState>(empty);
export const useStudentComments=()=>useContext(Comments);
export function StudentCommentsProvider({studentId,t,onAction,children}:{studentId:string;t:(en:string,es:string)=>string;onAction?:(seed:ActionSeed)=>void;children:ReactNode}){
 const request=useGuidanceRequest(),{user}=useAuth0();
 return <GuidancePanel key={`${user?.sub}:${studentId}`} studentId={studentId} request={request} t={t} onAction={onAction} renderStudent={state=><Comments.Provider value={state}>{children}</Comments.Provider>}/>;
}
export function StudentEntryComments({id,kind='note',topic}:{id:string;kind?:'note'|'memory';topic:string}){
 const comments=useStudentComments();
 return <>{comments.render(comments.items.filter(f=>f.anchor?.kind===kind&&f.anchor.id===id&&f.topic===topic))}</>;
}
