import NativeWelcome from './NativeWelcome';
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
function SkipContent(){return <a className="skip-content" href="#origen-main-content" onClick={event=>{const main=document.querySelector('main');if(main){event.preventDefault();main.id='origen-main-content';main.tabIndex=-1;main.focus();main.scrollIntoView();}}}>Skip to content / Saltar al contenido</a>;}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Auth0Provider domain={authConfig.domain} clientId={authConfig.clientId} authorizationParams={{redirect_uri:window.location.origin,audience:authConfig.audience,scope:'openid profile email'}} onRedirectCallback={state=>{sessionStorage.setItem('origen-login-event',crypto.randomUUID());const target=typeof state?.returnTo==='string'&&(/^#(?:invite|institution-invite)\/[A-Za-z0-9_-]{43}$/.test(state.returnTo)||state.returnTo==='#institutions')?'/'+state.returnTo:'/#app';window.history.replaceState({},document.title,target);window.dispatchEvent(new HashChangeEvent('hashchange'));}}><SkipContent/>{window.location.hash==='#native-welcome'?<NativeWelcome/>:<Entry />}</Auth0Provider></React.StrictMode>);
