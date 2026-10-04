import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {loadLocal,saveLocal,type StudentProfile} from './planning';

export type Account={firstName:string;email:string};
type Family={account:Account;students:StudentProfile[]};
type Store=Family&{cloud:boolean;loading:boolean;error:boolean;errorCode:string;saving:boolean;reload:()=>void;completeOnboarding:(firstName:string,student?:StudentProfile)=>Promise<boolean>;saveAccount:(account:Account)=>Promise<boolean>;saveStudent:(student:StudentProfile)=>Promise<boolean>;removeStudent:(id:string)=>Promise<boolean>};
const Context=createContext<Store|null>(null);
export function useFamily(){const store=useContext(Context);if(!store)throw new Error('FamilyProvider is required');return store;}

export function FamilyProvider({children,previewStudents}:{children:ReactNode;previewStudents:StudentProfile[]}){
 const {isAuthenticated,user,getAccessTokenSilently}=useAuth0();
 const cloud=isAuthenticated&&!!user?.sub;
 const scope=cloud?`origen.user.${user!.sub}`:'camino';
 const accountKey=cloud?`origen.account.${user!.sub}`:'origen.account-preview.v1';
 const [family,setFamily]=useState<Family>(()=>({account:loadLocal<Account>(accountKey,{firstName:'',email:''}),students:loadLocal<StudentProfile[]>(`${scope}.students.v1`,cloud?[]:previewStudents)}));
 const [loading,setLoading]=useState(cloud),[error,setError]=useState(false),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0);
 const [errorCode,setErrorCode]=useState('');
 const busy=useRef(false);
 async function request(operation:Record<string,unknown>,signal?:AbortSignal):Promise<Family>{
  const token=await getAccessTokenSilently();
  const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
  const response=await fetch(`${base}/api/family`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(operation),signal});
  const result=await response.json();
  if(!response.ok||!Array.isArray(result.students)||!result.account)throw new Error(result.error||'family_unavailable');
  return result;
 }
 useEffect(()=>{
  if(!cloud)return;
  const controller=new AbortController();let active=true;
  setLoading(true);setError(false);
  void (async()=>{
   let next=await request({action:'load'},controller.signal);
   // Only this authenticated user's old records are eligible; preview data stays local.
   const localStudents=loadLocal<StudentProfile[]>(`${scope}.students.v1`,[]);
   const localAccount=loadLocal<Account>(accountKey,{firstName:'',email:''});
   if(localStudents.length||localAccount.firstName||localAccount.email){
    next=await request({action:'import',source:'web',account:{firstName:localAccount.firstName||'',email:localAccount.email||''},students:localStudents},controller.signal);
   }
   if(active)setFamily(next);
  })().catch(()=>{if(active)setError(true);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[cloud,scope,accountKey,attempt]); // Provider remounts when the Auth0 identity changes.
 async function mutate(operation:Record<string,unknown>,next:Family){
  if(busy.current||loading)return false;
  busy.current=true;setSaving(true);setError(false);setErrorCode('');
  try{
   if(cloud)setFamily(await request(operation));
   else{
    if(!saveLocal(`${scope}.students.v1`,next.students)||!saveLocal(accountKey,next.account))throw new Error('local_save_failed');
    setFamily(next);
   }
   return true;
  }catch(cause){setErrorCode(cause instanceof Error?cause.message:'family_unavailable');setError(true);return false;}
  finally{busy.current=false;setSaving(false);}
 }
 return <Context.Provider value={{...family,cloud,loading,error,errorCode,saving,reload:()=>setAttempt(n=>n+1),
  completeOnboarding:(firstName,student)=>{const account={...family.account,firstName};return mutate({action:'complete-onboarding',account,...(student?{student}:{})},{account,students:student?(family.students.some(s=>s.id===student.id)?family.students.map(s=>s.id===student.id?student:s):[...family.students,student]):family.students});},
  saveAccount:account=>mutate({action:'save-account',account},{...family,account}),
  saveStudent:student=>mutate({action:'save-student',student},{...family,students:family.students.some(s=>s.id===student.id)?family.students.map(s=>s.id===student.id?student:s):[...family.students,student]}),
  removeStudent:id=>mutate({action:'delete-student',id},{...family,students:family.students.filter(s=>s.id!==id)})
 }}>{children}</Context.Provider>;
}
