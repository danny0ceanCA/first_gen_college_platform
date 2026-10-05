import {useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WebView,type WebViewMessageEvent} from 'react-native-webview';
import {useSession} from './Session';
import type {Account,Student} from './family';

const webOrigin=new URL(process.env.EXPO_PUBLIC_WEB_URL||'https://origenedu.ai').origin;
const uri=`${webOrigin}/#native-welcome`;
function trusted(url:string){try{const target=new URL(url);return target.protocol==='https:'&&target.origin===webOrigin&&target.pathname==='/'&&target.hash==='#native-welcome';}catch{return false;}}

export default function Welcome({account,es,save,logout,onFinished}:{account:Account;es:boolean;save:(account:Account,student?:Student)=>Promise<boolean>;logout:()=>void;onFinished?:()=>void}){
 const session=useSession();const view=useRef<WebView>(null);const location=useRef(uri);const [error,setError]=useState(false);const saving=useRef(false);
 const reply=(id:string,value:unknown,error=false)=>{if(trusted(location.current))view.current?.injectJavaScript(`window.origenNativeReply?.(${JSON.stringify({id,value,error})});true;`);};
 async function message(event:WebViewMessageEvent){
  if(!trusted(event.nativeEvent.url)||!trusted(location.current))return;
  let data;try{data=JSON.parse(event.nativeEvent.data);}catch{return;}
  if(typeof data.id!=='string'||data.id.length>100)return;
  try{
   if(data.type==='closed'){onFinished?.();return;}
   if(data.type==='ready'){reply(data.id,{subject:session.subject,firstName:account.firstName,role:account.role,language:es?'es':'en'});return;}
   if(data.type==='token'){reply(data.id,await session.getToken());return;}
   if(data.type==='complete'){
    if(saving.current)throw new Error();
    const p=data.payload;
    if(!p||typeof p.firstName!=='string'||!p.firstName.trim()||p.firstName.length>100||!['parent','student'].includes(p.role))throw new Error();
    let student:Student|undefined;
    if(p.student){const s=p.student;if(!s||['id','name','stage','interest','gpa','color'].some(key=>typeof s[key]!=='string')||!s.name.trim()||Object.values(s).some(value=>typeof value!=='string'||value.length>2000))throw new Error();const {interest,...rest}=s;student={...rest,interests:interest} as Student;}
    saving.current=true;
    try{if(!await save({...account,firstName:p.firstName.trim(),role:p.role},student))throw new Error();reply(data.id,true);}finally{saving.current=false;}
   }
  }catch{reply(data.id,null,true);}
 }
 return <SafeAreaView style={styles.root}><View style={styles.toolbar}><Pressable accessibilityRole="button" onPress={logout}><Text style={styles.exit}>{es?'Salir':'Exit'}</Text></Pressable></View>{error?<View style={styles.error}><Text style={styles.text}>{es?'No se pudo abrir Origen. Revisa tu conexión.':'Could not open Origen. Check your connection.'}</Text><Pressable accessibilityRole="button" onPress={()=>setError(false)}><Text style={styles.exit}>{es?'Intentar de nuevo':'Try again'}</Text></Pressable></View>:<WebView ref={view} source={{uri}} style={styles.web} originWhitelist={[webOrigin]} onShouldStartLoadWithRequest={request=>trusted(request.url)} onNavigationStateChange={state=>{location.current=state.url;if(!trusted(state.url)){view.current?.stopLoading();setError(true);}}} onMessage={event=>void message(event)} onError={()=>setError(true)} onHttpError={()=>setError(true)} onContentProcessDidTerminate={()=>setError(true)} onRenderProcessGone={()=>setError(true)} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="prompt" javaScriptCanOpenWindowsAutomatically={false} onOpenWindow={()=>{}} mixedContentMode="never" allowFileAccess={false} thirdPartyCookiesEnabled={false}/>}</SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#204e43'},web:{flex:1,backgroundColor:'#204e43'},toolbar:{alignItems:'flex-end',paddingHorizontal:20},exit:{color:'#eadcc4',paddingVertical:12,fontSize:15},error:{padding:24},text:{color:'#eadcc4',fontSize:18,lineHeight:28}});
