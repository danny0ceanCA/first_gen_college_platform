// Run through playwright-cli run-code after the disposable server is ready.
// Replace __PHASE8_BROWSER_FIXTURE__ with the JSON in
// tmp/coordinator-phase8-browser.json in a temporary copy before running it.
async page=>{
 const fixture=__PHASE8_BROWSER_FIXTURE__,origin=new URL(page.url()).origin,errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),actor=request.headers().authorization?.replace('Bearer ','')||'other';
  const response=await page.request.post(fixture.base+new URL(request.url()).pathname,{headers:{'Content-Type':'application/json','x-synthetic-actor':actor,'x-synthetic-secret':fixture.secret},data:request.postData()});
  await route.fulfill({status:response.status(),headers:{'Cache-Control':'no-store'},contentType:'application/json',body:await response.text()});
 });
 await page.route('**/coordinator-phase8-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import Connection from '/src/CoordinatorConnection.tsx';import Sharing from '/src/BinderSharing.tsx';import Inbox from '/src/CoordinatorInbox.tsx';import Binders from '/src/CoordinatorBinders.tsx';import {GuidancePanel} from '/src/CoordinatorGuidance.tsx';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';
 import {apiFetch,setAPITokenProvider} from '/src/api.ts';import {browserPrivacy} from '/src/browserPrivacy.mjs';import '/src/styles.css';import '/src/brand.css';import '/src/CoordinatorWorkspace.css';
 let actor='other';setAPITokenProvider(async()=>actor);browserPrivacy.start(actor,{fresh:true});
 async function request(path,input){const response=await apiFetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
 function Preview(){const [es,setEs]=React.useState(false),[staff,setStaff]=React.useState(false);const t=(a,b)=>es?b:a;return React.createElement('main',{style:{maxWidth:1000,margin:'24px auto',padding:'0 16px'}},React.createElement('nav',{style:{display:'flex',gap:12,flexWrap:'wrap'}},React.createElement('button',{onClick:()=>setEs(!es)},es?'English':'Español'),React.createElement('button',{onClick:()=>{actor=staff?'other':'staff';browserPrivacy.start(actor,{fresh:true});setStaff(!staff);}},staff?'Student view':'Coordinator view')),React.createElement('h1',null,t('Synthetic pilot rehearsal','Ensayo del piloto')),React.createElement('p',null,t('Test coordinator code: ','Código del coordinador de prueba: ')+${JSON.stringify(fixture.code)}),React.createElement('div',{key:String(staff)},staff?React.createElement(React.Fragment,null,React.createElement(Inbox,{organizationId:${JSON.stringify(fixture.org)},t,es}),React.createElement(Binders,{organizationId:${JSON.stringify(fixture.org)},t,es,request:input=>request('coordinator-binders',input),feedbackRequest:input=>request('coordinator-feedback',input)})):React.createElement(React.Fragment,null,React.createElement(Connection,{studentId:'alex',t}),React.createElement(Sharing,{studentId:'alex',t}),React.createElement(SharedVoiceContext.Provider,{value:{talkAbout:()=>{}}},React.createElement(GuidancePanel,{studentId:'alex',topic:'options',t,request:input=>request('coordinator-feedback',input)})))));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase8-preview');return {errors};
}
