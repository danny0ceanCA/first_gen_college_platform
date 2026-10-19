async page=>{
 const origin=new URL(page.url()).origin,errors=[],requests=[],guidance={id:'00000000-0000-4000-8000-000000000001',topic:'options',kind:'suggested-step',body:'Bring two majors you are curious about to our next meeting. We can compare the classes and career paths together.',resourceUrl:'https://example.org/college',version:1,authorName:'Maria Lopez',organizationName:'Community Learning Center',createdAt:'2026-10-18T12:00:00Z',editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,publicationItemId:null,replyCount:0};
 let items=[guidance],replies=[],revisions=[{version:1,body:guidance.body,kind:guidance.kind,resourceUrl:guidance.resourceUrl,createdAt:guidance.createdAt}],ended=false,paused=false,pending=[],hold=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('phase6Control',action=>{if(action==='end'){ended=true;guidance.connectionEnded=true;}if(action==='pause')paused=true;if(action==='hold')hold=true;if(action==='release'){pending.forEach(r=>r());pending=[];}return {errors,requests};});
 await page.route('**/api/coordinator-feedback',async route=>{
  const input=route.request().postDataJSON();requests.push(input);let status=200,result={status:'saved'};
  if(ended&&input.action.startsWith('staff-')){status=404;result={error:'binder_unavailable'};}
  else if(input.action.endsWith('-list'))result={feedback:items,writesEnabled:!paused};
  else if(input.action.endsWith('-thread'))result={revisions,replies};
  else if(input.action==='student-review')guidance.reviewed=true;
  else if(input.action==='student-hide')guidance.hidden=true;
  else if(input.action==='student-unhide')guidance.hidden=false;
  else if(input.action==='student-remove')items=[];
  else if(input.action==='student-reply'){replies.push({id:'reply',body:input.body,feedbackVersion:1,createdAt:new Date().toISOString()});guidance.replyCount++;}
  else if(input.action==='staff-edit'){Object.assign(guidance,{body:input.body,version:2,kind:input.kind,resourceUrl:input.resourceUrl,editedAt:new Date().toISOString()});revisions.push({version:2,body:input.body,kind:input.kind,resourceUrl:input.resourceUrl,createdAt:guidance.editedAt});}
  else if(input.action==='staff-create'){items.push({...guidance,id:'new-guidance',body:input.body,kind:input.kind,resourceUrl:input.resourceUrl});}
  const body=JSON.stringify(result);if(hold){hold=false;await new Promise(r=>pending.push(r));}await route.fulfill({status,headers:{'Cache-Control':'no-store'},contentType:'application/json',body});
 });
 await page.route('**/coordinator-phase6-preview',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {GuidancePanel} from '/src/CoordinatorGuidance.tsx';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';browserPrivacy.start('synthetic-student',{fresh:true});
 async function request(input){const response=await fetch('/api/coordinator-feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
 function Preview(){const [es,setEs]=React.useState(false),[staff,setStaff]=React.useState(false),[selection,setSelection]=React.useState('');return React.createElement('main',{style:{maxWidth:900,margin:'24px auto',padding:'0 16px'}},React.createElement('nav',null,React.createElement('button',{onClick:()=>setEs(!es)},es?'English':'Español'),React.createElement('button',{onClick:()=>setStaff(!staff)},staff?'Student view':'Coordinator view')),React.createElement('h1',null,es?'Opciones universitarias':'College options'),React.createElement('p',null,selection),React.createElement(SharedVoiceContext.Provider,{value:{talkAbout:v=>setSelection('Private voice selection: '+v.kind)}},React.createElement(GuidancePanel,{key:String(staff),...(staff?{organizationId:'00000000-0000-4000-8000-000000000010',grantId:'00000000-0000-4000-8000-000000000020',publicationId:'00000000-0000-4000-8000-000000000030'}:{studentId:'alex'}),topic:'options',request,t:(en,sp)=>es?sp:en,onAction:()=>setSelection('Separate student action draft selected')})));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
 </script></body></html>`}));
 await page.goto(origin+'/coordinator-phase6-preview');return {errors};
}
