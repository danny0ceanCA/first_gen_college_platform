async page=>{
 const origin=new URL(page.url()).origin;
 const org='00000000-0000-4000-8000-000000000010';
 const entries=[{id:'entry-one',topic:'options',kind:'note',language:'en',content:'Compare the campus visit dates before choosing where to apply.'},{id:'entry-two',topic:'costs',kind:'question',language:'es',content:'¿Qué preguntas debo preparar para mi reunión sobre ayuda financiera?'}];
 const binder={id:'00000000-0000-4000-8000-000000000001',studentName:'Alex Rivera',publicationId:'00000000-0000-4000-8000-000000000002',version:1,publishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90*86400000).toISOString(),topics:['options','costs'],isNew:true,helpRequested:true};
 let revoked=false,paused=false,holdNext=false,pending=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('phase5Control',action=>{if(action==='revoke')revoked=true;if(action==='pause')paused=true;if(action==='hold')holdNext=true;if(action==='release'){pending.forEach(fn=>fn());pending=[];}return {errors};});
 await page.route('**/api/coordinator-binders',async route=>{
  const v=route.request().postDataJSON();let status=200,result;
  if(paused){status=503;result={error:'coordinator_sharing_unavailable'};}
  else if(v.action==='list'){const match=!revoked&&binder.studentName.toLowerCase().includes((v.search||'').toLowerCase());result={counts:{all:match?1:0,new:match&&binder.isNew?1:0,help:match&&binder.helpRequested?1:0},binders:match&&(v.view!=='new'||binder.isNew)?[{...binder}]:[],nextCursor:null};}
  else if(revoked){status=404;result={error:'binder_unavailable'};}
  else if(v.action==='review'){binder.isNew=false;result={status:'reviewed'};}
  else result={...binder,entries};
  const body=JSON.stringify(result);
  if(holdNext){holdNext=false;await new Promise(r=>pending.push(r));}
  await route.fulfill({status,headers:{'Cache-Control':'no-store'},contentType:'application/json',body});
 });
 await page.route('**/coordinator-phase5-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Binders from '/src/CoordinatorBinders.tsx';import '/src/styles.css';import '/src/brand.css';import '/src/InstitutionPortal.css';import '/src/CoordinatorWorkspace.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';browserPrivacy.start('synthetic-coordinator',{fresh:true});
 async function request(input){const response=await fetch('/api/coordinator-binders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
 function Preview(){const [es,setEs]=React.useState(false);return React.createElement('main',{className:'institution-shell coordinator-workspace'},React.createElement('button',{onClick:()=>setEs(!es)},es?'English':'Español'),React.createElement('h1',null,es?'Tu espacio como coordinador':'Your coordinator workspace'),React.createElement(Binders,{organizationId:'${org}',request,es,t:(en,sp)=>es?sp:en}));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase5-preview');return {errors};
}
