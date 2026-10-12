async page=>{
 const origin='http://127.0.0.1:5192';
 const students=[{id:'synthetic-sofia',name:'Sofía',stage:'Community college',interest:'Environmental science',goals:'Transfer to a four-year university while continuing to work.',gpa:'',color:'lilac'},{id:'synthetic-mateo',name:'Mateo',stage:'10th grade',interest:'Design',gpa:'',color:'peach'}];
 const items=[{id:'one',studentId:students[0].id,mode:'planning',date:'2026-10-08T12:00:00Z',summary:'Sofía wants to ask a counselor which courses transfer.',sources:[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-08T12:00:00Z'}]},{id:'two',studentId:students[0].id,mode:'finance',date:'2026-10-09T12:00:00Z',summary:'We discussed the difference between grants and loans.',sources:[]},{id:'family',studentId:null,mode:'admissions',date:'2026-10-09T13:00:00Z',summary:'The family wants to compare application paths.',sources:[]},{id:'mateo',studentId:students[1].id,mode:'loans',date:'2026-10-09T14:00:00Z',summary:'Synthetic loan discussion',sources:[]}];
 let notes=[],receipts=[],conflict=false,failLoad=false;const requests=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('phase2Diagnostics',()=>({requests,errors}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON(),newUser=new URL(page.url()).searchParams.has('new');requests.push({path,body});let json={ok:true},status=200;
  if(path==='/api/test-control'){conflict=!!body.conflict;failLoad=!!body.failLoad;}
  else if(path==='/api/admin'){status=403;json={error:'admin_required'};}
  else if(path==='/api/family')json={account:{firstName:'Alex',role:newUser?'student':'parent',email:'',welcomeHeard:true},students:newUser?[students[0]]:students};
  else if(path==='/api/conversation-history')json={items:newUser?[]:items};
  else if(path==='/api/conversation-summary')json={summary:newUser?'':(body.language==='es'?'Resumen guardado para ': 'Saved summary for ')+(body.studentId===students[0].id?'Sofía':body.studentId===students[1].id?'Mateo':'the family')+'. '+(body.language==='es'?'Conversamos sobre tus opciones y las preguntas para un consejero.':'We discussed your options and the questions you want to bring to a counselor.'),date:'2026-10-09T12:00:00Z',sources:[]};
  else if(path==='/api/topic-notes'){
   if(body.action==='load'&&failLoad){status=503;json={error:'notes_unavailable'};}
   else{
    const match=notes.find(n=>n.id===body.id&&n.studentId===body.studentId);
    if(conflict&&body.action==='update'&&match){conflict=false;match.content='Updated in another window.';match.version++;status=409;json={error:'note_changed'};}
    else if(['update','delete','translate'].includes(body.action)&&(!match||body.version!==match.version)){status=409;json={error:'note_changed'};}
    else{
     if(body.action==='create')notes.push({id:body.id,studentId:body.studentId,...body.note,status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:new Date().toISOString(),sources:[],conversationAt:null});
     if(body.action==='update')Object.assign(match,body.note,{status:'saved',version:match.version+1,translations:{}});
     if(body.action==='delete')notes=notes.filter(n=>n!==match);
     if(body.action==='translate')match.translations[body.language]=body.language==='es'?'Quiero comparar programas de arte.':'I want to compare art programs.';
     if(body.action==='suggest'&&!receipts.includes(body.summaryId)){
      const source=items.find(i=>i.id===body.summaryId);receipts.push(body.summaryId);
      notes.push({id:crypto.randomUUID(),studentId:body.studentId,topic:'transfer',kind:'question',content:'Which courses transfer? Ask a counselor.',language:'en',status:'suggested',origin:'conversation',summaryId:source.id,quote:source.summary,translations:{},version:1,updatedAt:new Date().toISOString(),sources:source.sources,conversationAt:source.date});
     }
     json={notes:newUser?[]:notes.filter(n=>n.studentId===body.studentId),generatedSummaryIds:newUser?[]:receipts.filter(id=>items.some(i=>i.id===id&&i.studentId===body.studentId))};
    }
   }
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/App.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/topic-harness*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import App from '/src/App.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/overview.css';import '/src/guidance.css';import '/src/accessibility.css';import '/src/brand.css';
 localStorage.clear();localStorage.setItem('origen.language','en');
 const subject='auth0|synthetic-home',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/topic-harness');await page.locator('.notebook-topics').waitFor();
 return {ready:true};
}
