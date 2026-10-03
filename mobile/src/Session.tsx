import {createContext,useContext,type ReactNode} from 'react';
import {Platform} from 'react-native';
import Constants,{ExecutionEnvironment} from 'expo-constants';
import {authConfig} from './authConfig';

type Session={subject:string;loading:boolean;supported:boolean;login:()=>Promise<void>;logout:()=>Promise<void>;getToken:()=>Promise<string>};
const Context=createContext<Session|null>(null);
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider required');return value;}
const unsupported=async()=>{throw new Error('A development build is required for sign-in.');};
export function SessionProvider({children}:{children:ReactNode}){
 if(Platform.OS!=='web'&&Constants.executionEnvironment===ExecutionEnvironment.StoreClient)return <Context.Provider value={{subject:'',loading:false,supported:false,login:unsupported,logout:async()=>{},getToken:unsupported}}>{children}</Context.Provider>;
 // Delay loading the native module so the device-only preview still works in Expo Go.
 // eslint-disable-next-line @typescript-eslint/no-require-imports
 const sdk=require('react-native-auth0') as typeof import('react-native-auth0');
 return <sdk.Auth0Provider domain={authConfig.domain} clientId={Platform.OS==='web'?authConfig.webClientId:authConfig.clientId} useDPoP={false}><Bridge>{children}</Bridge></sdk.Auth0Provider>;
}
function Bridge({children}:{children:ReactNode}){
 // eslint-disable-next-line @typescript-eslint/no-require-imports
 const {useAuth0}=require('react-native-auth0') as typeof import('react-native-auth0');
 const auth=useAuth0();
 return <Context.Provider value={{subject:auth.user?.sub||'',loading:auth.isLoading,supported:true,
  login:async()=>{await auth.authorize({audience:authConfig.audience,scope:'openid profile email offline_access',...(Platform.OS==='web'?{redirectUrl:window.location.origin}:{})},{customScheme:authConfig.scheme});},
  logout:()=>auth.clearSession(Platform.OS==='web'?{returnToUrl:window.location.origin}:{},{customScheme:authConfig.scheme}),
  getToken:async()=>{const credentials=await auth.getCredentials(undefined,30,Platform.OS==='web'?{audience:authConfig.audience}:undefined);return credentials.accessToken;}
 }}>{children}</Context.Provider>;
}
