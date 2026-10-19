async page=>{
 const origin=new URL(page.url()).origin;
 const entries=[{id:'00000000-0000-4000-8000-000000000001',topic:'options',kind:'note',language:'en',content:'Compare the campus visit dates before choosing where to apply.'},{id:'00000000-0000-4000-8000-000000000002',topic:'costs',kind:'question',language:'es',content:'¿Qué preguntas debo preparar para mi reunión sobre ayuda financiera?'}];
 const recipient={id:'00000000-0000-4000-8000-000000000003',coordinatorName:'Marisol Rivera',organizationName:'Community Futures'};
 let grants=[],preview;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/binder-sharing',async route=>{
  const v=route.request().postDataJSON();let result={};
  if(v.action==='status')result={available:true,enabled:true,connections:[recipient],grants};
  if(v.action==='entries')result={entries};
  if(v.action==='preview'){preview={previewId:'00000000-0000-4000-8000-000000000004',studentName:'Alex',...recipient,topics:v.topics,entries:entries.filter(e=>v.entryIds.includes(e.id)),expiresAt:new Date(Date.now()+120000).toISOString(),shareExpiresAt:new Date(Date.now()+90*86400000).toISOString()};result=preview;}
  if(v.action==='publish'){grants=[{...recipient,id:'00000000-0000-4000-8000-000000000005',status:'active',expiresAt:preview.shareExpiresAt,topics:preview.topics,items:preview.entries}];result={status:'published'};}
  if(v.action==='withdraw')grants[0].items=grants[0].items.filter(e=>e.id!==v.itemId);
  if(v.action==='remove-topic'){grants[0].topics=grants[0].topics.filter(x=>x!==v.topic);grants[0].items=grants[0].items.filter(e=>e.topic!==v.topic);}
  if(['revoke','revoke-all'].includes(v.action)){grants=grants.map(g=>({...g,status:'revoked',items:[]}));result={status:'revoked'};}
  await route.fulfill({headers:{'Cache-Control':'no-store'},contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.route('**/coordinator-phase4-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Sharing from '/src/BinderSharing.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';browserPrivacy.start('synthetic-student',{fresh:true});setAPITokenProvider(async()=>'synthetic');
 function Preview(){const [es,setEs]=React.useState(false);return React.createElement('main',{style:{maxWidth:'960px',margin:'auto',padding:'16px'}},React.createElement('button',{onClick:()=>setEs(!es)},es?'English':'Español'),React.createElement('h1',null,es?'Mi carpeta':'My binder'),React.createElement(Sharing,{studentId:'alex',t:(en,sp)=>es?sp:en}));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase4-preview');return {errors};
}
