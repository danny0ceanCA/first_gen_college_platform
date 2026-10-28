import WorkspaceModule from './LoadingSurface';
import PrivateSession from './PrivateSession';
import LoginArrival from './WorkspaceArrival';
import {Auth0Provider} from '@auth0/auth0-react';
import {authConfig} from './authConfig';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Entry from './Entry';
import './styles.css';
import './overview.css';
import './guidance.css';
import './accessibility.css';
import './brand.css';
const GuardianPermission=React.lazy(()=>import('./GuardianPermission'));
const NativeWelcome=React.lazy(()=>import('./NativeWelcome'));
function SkipContent(){return <a className="skip-content" href="#origen-main-content" onClick={event=>{const main=document.querySelector('main');if(main){event.preventDefault();main.id='origen-main-content';main.tabIndex=-1;main.focus();main.scrollIntoView();}}}>Skip to content / Saltar al contenido</a>;}

const guardianToken=/^#guardian\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1];
if(guardianToken)window.history.replaceState({},document.title,'/#guardian');
createRoot(document.getElementById('root')!).render(guardianToken?<WorkspaceModule layout="workspace"><GuardianPermission token={guardianToken}/></WorkspaceModule>:<React.StrictMode><Auth0Provider domain={authConfig.domain} clientId={authConfig.clientId} authorizationParams={{redirect_uri:window.location.origin,audience:authConfig.audience,scope:'openid profile email'}} onRedirectCallback={state=>{sessionStorage.setItem('origen-login-session',crypto.randomUUID());sessionStorage.setItem('origen-login-event',crypto.randomUUID());sessionStorage.setItem('origen-login-fresh','1');const target=typeof state?.returnTo==='string'&&(/^#(?:invite|institution-invite)\/[A-Za-z0-9_-]{43}$/.test(state.returnTo)||state.returnTo==='#institutions'||state.returnTo==='#coordinators'||state.returnTo==='#coordinator-register'||/^#connect\/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(state.returnTo))?'/'+state.returnTo:'/#app';window.history.replaceState({},document.title,target);window.dispatchEvent(new HashChangeEvent('hashchange'));}}><SkipContent/>{window.location.hash==='#native-welcome'?<WorkspaceModule layout="workspace"><NativeWelcome/></WorkspaceModule>:<LoginArrival><PrivateSession><Entry /></PrivateSession></LoginArrival>}</Auth0Provider></React.StrictMode>);
