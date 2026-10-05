import {useEffect,useRef} from 'react';
import {useSession} from './Session';
import type {Account,Student} from './family';

const origin=new URL(process.env.EXPO_PUBLIC_WEB_URL||'https://origenedu.ai').origin;
export default function Welcome({account,es,save,logout,onFinished}:{account:Account;es:boolean;save:(account:Account,student?:Student)=>Promise<boolean>;logout:()=>void;onFinished?:()=>void}){
 const session=useSession();const frame=useRef<HTMLIFrameElement>(null);const saving=useRef(false);
 useEffect(()=>{
  const reply=(id:string,value:unknown,error=false)=>frame.current?.contentWindow?.postMessage({id,value,error},origin);
  const receive=async(event:MessageEvent)=>{
   if(event.origin!==origin||event.source!==frame.current?.contentWindow)return;
   const data=event.data;if(!data||typeof data.id!=='string'||data.id.length>100)return;
   try{
    if(data.type==='ready')reply(data.id,{subject:session.subject,firstName:account.firstName,role:account.role,language:es?'es':'en'});
    else if(data.type==='token')reply(data.id,await session.getToken());
    else if(data.type==='closed')onFinished?.();
    else if(data.type==='complete'){
     const p=data.payload;if(saving.current||!p||typeof p.firstName!=='string'||!p.firstName.trim()||p.firstName.length>100||!['parent','student'].includes(p.role))throw new Error();
     let student:Student|undefined;
     if(p.student){const s=p.student;if(['id','name','stage','interest','gpa','color'].some(key=>typeof s[key]!=='string')||!s.name.trim()||Object.values(s).some(value=>typeof value!=='string'||value.length>2000))throw new Error();const {interest,...rest}=s;student={...rest,interests:interest} as Student;}
     saving.current=true;
     try{if(!await save({...account,firstName:p.firstName.trim(),role:p.role},student))throw new Error();reply(data.id,true);}finally{saving.current=false;}
    }
   }catch{reply(data.id,null,true);}
  };
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[account,es,onFinished,save,session]);
 return <div style={{height:'100dvh',display:'flex',flexDirection:'column',background:'#204e43'}}><button onClick={logout} style={{alignSelf:'flex-end',background:'transparent',border:0,padding:12,color:'#eadcc4'}}>{es?'Salir':'Exit'}</button><iframe ref={frame} title="Origen live onboarding" src={`${origin}/#native-welcome`} allow={`microphone ${origin}; autoplay ${origin}`} referrerPolicy="origin" style={{flex:1,width:'100%',border:0}}/></div>;
}
