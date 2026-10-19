async page=>{
 const origin=new URL(page.url()).origin,contextId='00000000-0000-4000-8000-000000000001',challengeId='00000000-0000-4000-8000-000000000002';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let connected=false;
 await page.route('**/api/**',async route=>{
  const input=route.request().postDataJSON();let json={ok:true};
  if(input.action==='available')json={available:true,voiceEnabled:true};
  if(input.action==='open')json={contextId};
  if(input.action==='lookup'||input.action==='prepare')json={challengeId,expiresAt:new Date(Date.now()+120000).toISOString(),studentName:'Alex',coordinator:{id:'coordinator',name:'Marisol Rivera',organization:'Community Futures',role:'Coordinator'}};
  if(input.action==='confirm'){connected=true;json={status:'requested',sharingEnabled:false};}
  if(input.action==='withdraw')connected=false;
  if(input.action==='list'||input.action==='inbox')json={connections:connected?[{id:'connection',coordinatorName:'Marisol Rivera',organizationName:'Community Futures',displayName:'Alex',topics:['options'],status:'requested',expiresAt:new Date(Date.now()+604800000).toISOString()}]:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/CoordinatorConnection.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/coordinator-phase3-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';import Connection from '/src/CoordinatorConnection.tsx';import Inbox from '/src/CoordinatorInbox.tsx';import '/src/styles.css';import '/src/brand.css';import '/src/InstitutionPortal.css';import '/src/CoordinatorWorkspace.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';browserPrivacy.start('synthetic-student',{fresh:true});setAPITokenProvider(async()=>'synthetic');
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'synthetic-student'}};
 function Preview(){const [es,setEs]=React.useState(false);return React.createElement('main',{className:'institution-shell'},React.createElement('button',{onClick:()=>setEs(!es)},es?'English':'Español'),React.createElement('h1',null,es?'Mi carpeta':'My binder'),React.createElement(Connection,{studentId:'alex',t:(en,sp)=>es?sp:en}),React.createElement(Inbox,{organizationId:'00000000-0000-4000-8000-000000000003',es,t:(en,sp)=>es?sp:en}));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Preview)));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase3-preview');return {errors};
}
