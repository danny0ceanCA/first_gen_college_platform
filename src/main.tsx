import {Auth0Provider} from '@auth0/auth0-react';
import {authConfig} from './authConfig';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Entry from './Entry';
import './styles.css';
import './overview.css';
import './guidance.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Auth0Provider domain={authConfig.domain} clientId={authConfig.clientId} authorizationParams={{redirect_uri:window.location.origin,audience:authConfig.audience}} onRedirectCallback={state=>{const target=typeof state?.returnTo==='string'&&/^#invite\/[A-Za-z0-9_-]{43}$/.test(state.returnTo)?'/'+state.returnTo:'/#app';window.history.replaceState({},document.title,target);window.dispatchEvent(new HashChangeEvent('hashchange'));}}><Entry /></Auth0Provider></React.StrictMode>);
