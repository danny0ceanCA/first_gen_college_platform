import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Pressable,ScrollView,Text,View} from 'react-native';
import {useSession} from './Session';
import {authConfig} from './authConfig';
import Welcome from './Welcome';

export function NativeAgeScreen({onContinue,onExit}:{onContinue:()=>void;onExit:()=>void}){
 const [age,setAge]=useState(''),[audience,setAudience]=useState(''),[blocked,setBlocked]=useState(false);
 const choice=(value:string,label:string,current:string,set:(v:string)=>void)=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:current===value}} onPress={()=>set(value)} style={{padding:16,borderWidth:1,borderColor:current===value?'#402d26':'#b6a59a',marginVertical:5}}><Text>{label}</Text></Pressable>;
 return <ScrollView contentContainerStyle={{padding:24,backgroundColor:'#fbf8f3',flexGrow:1}}><Text style={{fontSize:26,marginBottom:16}}>Before you begin / Antes de comenzar</Text>{blocked?<Text>We cannot open registration for this request. / No podemos abrir el registro para esta solicitud. daniel@origenedu.ai</Text>:<><Text>Which age group are you in? / ¿En qué grupo de edad estás?</Text>{[['under13','Under 13 / Menos de 13'],['13to17','13–17'],['18plus','18 or older / 18 o más']].map(([v,l])=>choice(v,l,age,setAge))}<Text style={{marginTop:20}}>Which describes your current situation? / ¿Qué describe tu situación actual?</Text>{[['grade9plus','Student in ninth grade or later / Estudiante de noveno grado en adelante'],['adult_supporter','Adult supporting a student / Adulto que apoya a un estudiante'],['other','Another situation / Otra situación']].map(([v,l])=>choice(v,l,audience,setAudience))}<Pressable accessibilityRole="button" disabled={!age||!audience} onPress={()=>{if(age==='under13'||audience==='other'||audience==='adult_supporter'&&age!=='18plus')setBlocked(true);else onContinue();}} style={{padding:16,marginVertical:16}}><Text>Continue / Continuar</Text></Pressable></>}<Pressable accessibilityRole="button" onPress={onExit} style={{padding:16}}><Text>Return / Volver</Text></Pressable></ScrollView>;
}
export default function MobilePermission({children}:{children:ReactNode}){
 const session=useSession(),[allowed,setAllowed]=useState(false),[checked,setChecked]=useState(false),[checkedSubject,setCheckedSubject]=useState(''),[retry,setRetry]=useState(0);const generation=useRef(0),getToken=useRef(session.getToken);
 useEffect(()=>{getToken.current=session.getToken;},[session.getToken]);
 useEffect(()=>{
  if(!session.subject)return;
  const current=++generation.current,controller=new AbortController();let busy=false;
  const poll=async()=>{if(busy)return;busy=true;const requestController=new AbortController(),abort=()=>requestController.abort();controller.signal.addEventListener('abort',abort);const deadline=setTimeout(abort,10000);try{const token=await Promise.race([getToken.current(),new Promise<never>((_,reject)=>requestController.signal.addEventListener('abort',()=>reject(new Error('permission_unavailable')),{once:true}))]);controller.signal.throwIfAborted();const response=await fetch(`${authConfig.apiUrl.replace(/\/$/,'')}/api/eligibility`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'status'}),signal:requestController.signal});const data=await response.json();if(current===generation.current&&!controller.signal.aborted)setAllowed(response.ok&&data.subject===session.subject&&data.allowed===true);}catch{if(current===generation.current&&!controller.signal.aborted)setAllowed(false);}finally{clearTimeout(deadline);controller.signal.removeEventListener('abort',abort);busy=false;if(current===generation.current&&!controller.signal.aborted){setChecked(true);setCheckedSubject(session.subject);}}};
  void poll();const timer=setInterval(()=>void poll(),5000);return()=>{controller.abort();clearInterval(timer);};
 },[session.subject,retry]);
 if(!session.subject)return <>{children}</>;
 if(!checked||checkedSubject!==session.subject)return <View style={{padding:24}}><Text>Checking permission… / Comprobando el permiso…</Text></View>;
 if(!allowed)return <Welcome permissionOnly account={{firstName:'',email:''}} es={false} save={async()=>false} logout={()=>void session.logout()} onFinished={()=>setRetry(n=>n+1)}/>;
 return <>{children}</>;
}
