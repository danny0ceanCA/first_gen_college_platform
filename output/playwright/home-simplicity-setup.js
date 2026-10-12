async page=>{
 const origin='http://127.0.0.1:5192';
 const students=[{id:'synthetic-sofia',name:'Sofía',stage:'Community college',interest:'Environmental science',goals:'Transfer to a four-year university while continuing to work.',gpa:'',color:'lilac'},{id:'synthetic-mateo',name:'Mateo',stage:'10th grade',interest:'Design',gpa:'',color:'peach'}];
 const items=[{id:'one',studentId:students[0].id,mode:'planning',date:'2026-10-08T12:00:00Z',summary:'Sofía wants to ask a counselor which courses transfer.',sources:[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-08T12:00:00Z'}]},{id:'two',studentId:students[0].id,mode:'finance',date:'2026-10-09T12:00:00Z',summary:'We discussed the difference between grants and loans.',sources:[]},{id:'family',studentId:null,mode:'admissions',date:'2026-10-09T13:00:00Z',summary:'The family wants to compare application paths.',sources:[]},{id:'mateo',studentId:students[1].id,mode:'loans',date:'2026-10-09T14:00:00Z',summary:'Synthetic loan discussion',sources:[]}];
 let notes=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',studentId:'synthetic-sofia',topic:'transfer',kind:'question',content:'Which courses transfer? Ask a counselor.',language:'en',status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:new Date().toISOString(),sources:[],conversationAt:null}],receipts=[],conflict=false,failLoad=false,plans=[{id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',studentId:'synthetic-sofia',title:'My next steps',goal:'',category:'transfer',status:'active',version:1,summaryIds:[],steps:[{id:'counselor',title:'Meet with my counselor',action:'Ask about transfer courses.',notes:'',status:'not-started',dueDate:null,sources:[]}]}],creationIds=[],planConflict=false,failPlan=false;const requests=[],errors=[];let voiceFail=false; let sheets=[];let failSheets=false;let staleSheet=false;
 page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('phase5Diagnostics',()=>({requests,errors}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON(),newUser=new URL(page.url()).searchParams.has('new');requests.push({path,body});let json={ok:true},status=200;
  if(path==='/api/test-control'){failSheets=!!body.failSheets;staleSheet=!!body.staleSheet;voiceFail=!!body.voiceFail;conflict=!!body.conflict;failLoad=!!body.failLoad;planConflict=!!body.planConflict;failPlan=!!body.failPlan;}
  else if(path==='/api/admin'){status=403;json={error:'admin_required'};}
  else if(path==='/api/workspace-sheets'){
   const record=sheets.find(s=>s.id===body.id&&s.studentId===body.studentId);
   if(failSheets){status=503;json={error:'sheets_unavailable'};}
   else if(body.action==='prepare')json={goal:body.includeGoal?'Transfer while working.':'',entries:body.notes.map(p=>({kind:'question',text:notes.find(n=>n.id===p.id).content,done:false})).concat(body.actions.map(p=>({kind:'action',text:'Meet with my counselor. Ask about transfer courses.',done:false}))),sources:body.includeSources?[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-08T12:00:00Z'}]:[]};
   else if(staleSheet&&body.action==='update'){staleSheet=false;if(record){record.version++;record.sheet.goal='Updated in another window.';}status=409;json={error:'sheet_changed'};}
   else if(['update','delete'].includes(body.action)&&(!record||record.version!==body.version)){status=409;json={error:'sheet_changed'};}
   else{if(body.action==='create'&&!record)sheets.push({id:body.id,studentId:body.studentId,sheet:body.sheet,version:1,updatedAt:new Date().toISOString()});if(body.action==='update')Object.assign(record,{sheet:body.sheet,version:record.version+1});if(body.action==='delete')sheets=sheets.filter(s=>s!==record);json={sheets:sheets.filter(s=>s.studentId===body.studentId)};}
  }
  else if(path==='/api/profile-voice'){if(voiceFail){status=409;json={error:'workspace_item_changed'};}else json=body.action==='update-guide'?{session:{type:'realtime',instructions:'Synthetic workspace context '+JSON.stringify(body.workspaceFocus||{})+' in '+body.language,tools:[],tool_choice:'auto'}}:{sdp:'v=0\r\nanswer',playWelcome:false};}
  else if(path==='/api/family')json={account:{firstName:'Alex',role:newUser?'student':'parent',email:'',welcomeHeard:true},students:newUser?[students[0]]:students};
  else if(path==='/api/conversation-history'){if(new URL(page.url()).searchParams.has('failHistory')){status=503;json={error:'history_unavailable'};}else json={items:newUser?[]:items};}
  else if(path==='/api/conversation-summary')json={summary:newUser?'':(body.language==='es'?'Resumen guardado para ': 'Saved summary for ')+(body.studentId===students[0].id?'Sofía':body.studentId===students[1].id?'Mateo':'the family')+'. '+(body.language==='es'?'Conversamos sobre tus opciones y las preguntas para un consejero.':'We discussed your options and the questions you want to bring to a counselor.'),date:'2026-10-09T12:00:00Z',sources:[]};
  else if(path==='/api/plans'){
   const current=plans.find(p=>p.id===body.id);
   if(failPlan&&body.action==='load'){status=503;json={error:'plans_unavailable'};}
   else if(body.action==='update'&&planConflict&&current){planConflict=false;current.version++;current.steps[0].action='Updated in another window.';status=409;json={error:'plan_changed'};}
   else if(['update','delete'].includes(body.action)&&(!current||current.version!==body.version)){status=409;json={error:'plan_changed'};}
   else{
    if(body.action==='create'&&!creationIds.includes(body.requestId)){creationIds.push(body.requestId);plans.push({...body.plan,id:crypto.randomUUID(),version:1});}
    if(body.action==='update')Object.assign(current,body.plan,{version:current.version+1});
    if(body.action==='delete')plans=plans.filter(p=>p!==current);
    json={plans:newUser?[]:body.action==='load'?plans.filter(p=>p.studentId===body.studentId):plans,creationIds,supportsActions:true,limited:false};
   }
  }
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
 await page.addInitScript(()=>{
  window.sheetConfirmations=[];window.confirm=message=>{window.sheetConfirmations.push(message);return true;};const originalAdd=window.addEventListener;window.addEventListener=function(type,...args){if(type==='beforeunload'){window.sheetUnloadGuard=true;return;}return originalAdd.call(this,type,...args);};
  const diagnostics={connections:0,closed:0,messages:[],hold:false,reply:0,pending:[]};window.voiceFixture=diagnostics;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[{kind:'audio',enabled:true,stop(){}}],getAudioTracks:()=>[]})});
  class Peer{
   constructor(){diagnostics.connections++;this.connectionState='new';}
   addTrack(){} async createOffer(){return {type:'offer',sdp:'v=0\r\n'};} async setLocalDescription(){}
   createDataChannel(){const pc=this;this.dc={readyState:'connecting',send(text){const event=JSON.parse(text);diagnostics.messages.push(event);if(event.type==='session.update')setTimeout(()=>pc.emit({type:'session.updated',session:event.session}),20);if(event.type==='response.create'){const id='answer-'+(++diagnostics.reply);pc.emit({type:'response.created',response:{id}});pc.emit({type:'output_audio_buffer.started',response_id:id});pc.emit({type:'response.done',response:{id,status:'completed',output:[]}});if(diagnostics.hold)diagnostics.pending.push(id);else setTimeout(()=>pc.emit({type:'output_audio_buffer.stopped',response_id:id}),80);}},close(){this.readyState='closed';}};window.voiceEmit=event=>pc.emit(event);window.finishVoiceReply=()=>{diagnostics.hold=false;for(const id of diagnostics.pending.splice(0))pc.emit({type:'output_audio_buffer.stopped',response_id:id});};return this.dc;}
   emit(event){void this.dc?.onmessage?.({data:JSON.stringify(event)});}
   async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.readyState='open';this.emit({type:'session.created',session:{instructions:'Synthetic initial context'}});this.dc.onopen?.();}
   close(){diagnostics.closed++;this.connectionState='closed';}
  }
  window.RTCPeerConnection=Peer;
 });
 const source=await(await page.request.get(origin+'/src/App.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/sheet-workspace-harness*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import App from '/src/App.tsx';import {setAPITokenProvider} from '/src/api.ts';import {browserPrivacy} from '/src/browserPrivacy.mjs';import '/src/styles.css';import '/src/overview.css';import '/src/guidance.css';import '/src/accessibility.css';import '/src/brand.css';
 localStorage.clear();localStorage.setItem('origen.language','en');localStorage.setItem('camino.plans.v1',JSON.stringify({'synthetic-sofia':[{title:'PREVIEW MUST NOT IMPORT'}]}));
 const subject='auth0|synthetic-home',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;browserPrivacy.start(subject,{fresh:true});setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/sheet-workspace-harness');await page.locator('.home-conversation').waitFor();
 return {ready:true};
}

