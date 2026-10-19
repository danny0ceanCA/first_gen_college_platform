async page=>{
 const origin='http://127.0.0.1:5173',org='00000000-0000-4000-8000-000000000001';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const input=route.request().postDataJSON();let json={ok:true};
  if(input.action==='overview')json={canApprove:false,organizations:[{id:org,name:'Community Futures',role:'owner',pilotStatus:'active',verificationStatus:'verified',profile:{id:'profile',displayName:'Marisol Rivera',status:'active'}}]};
  if(input.action==='team')json={members:[{subject:'staff',name:'Marisol Rivera',role:'owner',coordinatorStatus:'active'},{subject:'new',name:'Alex Chen',role:'outreach',coordinatorStatus:'disabled'}]};
  if(input.action==='profile')json={profile:{displayName:'Marisol Rivera',organizationName:'Community Futures',code:null}};
  if(input.action==='rotate-code')json={code:'ABCDE-FGHJK',expiresAt:'2026-11-18T00:00:00Z'};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/CoordinatorWorkspace.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/coordinator-phase2-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';import Workspace from '/src/CoordinatorWorkspace.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';browserPrivacy.start('synthetic-coordinator',{fresh:true});
 const getAccessTokenSilently=async()=>'synthetic';const auth={isAuthenticated:true,isLoading:false,user:{sub:'synthetic-coordinator'},getAccessTokenSilently,logout:async()=>{},loginWithRedirect:async()=>{}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Workspace)));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase2-preview');
 return {errors};
}
