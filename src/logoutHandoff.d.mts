import type {Auth0ContextInterface} from '@auth0/auth0-react';
type LogoutOptions=Parameters<Auth0ContextInterface['logout']>[0];
type HandoffStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const LOGOUT_COVER_MS:number;
export const LOGOUT_REVEAL_MS:number;
export function clearLogoutReturn(storage?:HandoffStorage):void;
export function readLogoutReturn(storage?:HandoffStorage,now?:number):boolean;
export function createLogoutTransition(options:{
 cleanup:()=>Promise<unknown>|void;
 stop:()=>void;
 redirect:(options?:LogoutOptions)=>Promise<void>;
 cover:()=>Promise<void>;
 onPhase:(phase:'leaving'|'revealing'|'error')=>void;
 storage?:HandoffStorage;
 now?:()=>number;
}):{readonly canReturn:boolean;start:(options?:LogoutOptions)=>Promise<void>};
