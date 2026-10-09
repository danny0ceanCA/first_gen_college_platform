async page => {
 const origin='http://127.0.0.1:5178',requests=[];
 let historyFailure=true,eventFailure=true,deny=false;
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const user=(i,name)=>({id:ids[i],first_name:name,role:i===0?'student':null,created_at:'2026-09-20T10:00:00Z',profile_complete:i===0,onboarding_started_at:'2026-09-20T10:01:00Z',onboarding_completed_at:i===0?'2026-10-09T19:03:00Z':null,logins:2,last_login:'2026-10-09T19:00:00Z',voice_minutes:1,calls:1});
 const users=[user(0,'Returning visitor'),user(1,'Earlier visitor'),user(2,'Tracking unavailable')];
 const attempt=(i)=>({id:`aaaaaaa${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,started_at:`2026-10-0${9-i}T19:00:00Z`,last_received_at:`2026-10-0${9-i}T19:04:00Z`,resumed:i===0,saved_at:i===0?'2026-10-09T19:03:00Z':null,eventCount:i===0?53:3,homeReached:i===0,logoutSelected:i===1,saveFailed:i===0,voiceFailed:i===1,clientSaveSucceeded:i===0});
 const attempts=Array.from({length:6},(_,i)=>attempt(i));
 const events=Array.from({length:53},(_,i)=>({producer:i===50?'server':'client',sequence:i+1,name:i===0?'onboarding_opened':i===1?'fields_updated':i===2?'microphone_denied':i===3?'save_failed':i===50?'profile_saved':i===51?'save_succeeded':i===52?'home_reached':'page_visible',occurred_at:new Date(Date.parse('2026-10-09T19:00:00Z')+i*1000).toISOString(),received_at:'2026-10-09T19:04:00Z',metadata:i===0?{language:'es',restored:true,method:'voice'}:i===1?{fields:{account_name:true,student_name:true,school:false}}:i===2?{code:'NotAllowedError'}:{}}));
 events[4]={...events[4],name:'first_agent_audio',metadata:{durationMs:1200}};
 events[5]={...events[5],name:'user_speech_transcription',metadata:{status:'timeout',speechIndex:2}};
 events[6]={...events[6],name:'save_confirmation_finished',metadata:{durationMs:800,playbackReady:false,status:'drained'}};
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  if(deny)return route.fulfill({status:403,contentType:'application/json',body:'{"error":"admin_required"}'});
  let json,status=200;
  if(body.action==='onboarding-metrics')json={coverage:{available:false,measuredSince:null,retentionDays:90}};
  else if(body.action==='onboarding-alerts')json={available:false};
  else if(body.action==='users')json={users,total:3,page:1,pageSize:25,funnel:{measured_since:'2026-10-01T00:00:00Z',registered:3,started:3,completed:1,first_conversation:1,untracked:0}};
  else if(body.action==='user-detail')json={user:users.find(u=>u.id===body.id),activity:[{id:'signin',event:'sign_in',occurred_at:'2026-10-09T19:00:00Z',minutes:0,topic:''}]};
  else if(body.action==='onboarding-timeline'){
   if(historyFailure){historyFailure=false;status=503;json={error:'onboarding_history_unavailable'};}
   else json={attempts:body.id===ids[0]?attempts.slice((body.page-1)*5,body.page*5):[],total:body.id===ids[0]?6:0,page:body.page,pageSize:5,coverage:{available:body.id!==ids[2],measuredSince:body.id===ids[2]?null:'2026-10-01T00:00:00Z',retainedSince:'2026-07-11T00:00:00Z',olderAccount:true}};
  }else if(body.action==='onboarding-attempt'){
   if(eventFailure){eventFailure=false;status=503;json={error:'onboarding_history_unavailable'};}
   else{const all=body.attemptId===attempts[0].id?events:[{...events[0],name:'onboarding_opened'},{...events[2],name:'voice_connection_failed'},{...events[3],name:'logout_selected'}];json={events:all.slice((body.page-1)*50,body.page*50),total:all.length,page:body.page,pageSize:50};}
  }else throw new Error('Unexpected synthetic request '+JSON.stringify(body));
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/AdminUsers.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/phase2-test-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import {Auth0Context} from '${authModule}';import AdminUsers from '/src/AdminUsers.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/admin.css';import '/src/brand.css';
 const subject='auth0|phase2-admin',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{}};
 function Harness(){const [denied,setDenied]=React.useState(false),[days,setDays]=React.useState(30);return denied?React.createElement('p',null,'Access denied'):React.createElement('div',{className:'admin-workspace'},React.createElement('main',{className:'admin-dashboard'},React.createElement('label',null,'Period',React.createElement('select',{'aria-label':'Test period',value:days,onChange:e=>setDays(Number(e.target.value))},...[7,30,90].map(d=>React.createElement('option',{key:d,value:d},d+' days')))),React.createElement(AdminUsers,{days,revision:0,onDenied:()=>setDenied(true)})));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Harness)));
 </script></body></html>`}));
 await page.setViewportSize({width:1200,height:900});await page.goto(origin+'/phase2-test-harness');
 await page.getByRole('button',{name:'Returning visitor',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Retry history'}).click();
 await dialog.getByRole('button',{name:'Retry events'}).click();
 await dialog.getByText('Microphone access denied',{exact:true}).waitFor();
 await dialog.getByText('Provided: Account name, Student name.',{exact:true}).waitFor();
 await dialog.getByText('Not provided: School.',{exact:true}).waitFor();
 await dialog.getByText('Spanish · Voice setup · Browser draft restored',{exact:true}).waitFor();
 await dialog.getByText('After voice request: 1.2 s',{exact:true}).waitFor();
 await dialog.getByText('Transcription timed out',{exact:true}).waitFor();
 await dialog.getByText('Browser playback was not ready; audibility is unknown.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Next events',exact:true}).click();
 await dialog.getByText('Profile saved · server confirmed',{exact:true}).waitFor();
 await dialog.getByText('Web home page reached',{exact:true}).waitFor();
 await dialog.getByText('Browser received save confirmation',{exact:true}).waitFor();
 await dialog.getByText('This account predates detailed capture; earlier visits cannot be reconstructed.',{exact:false}).waitFor();
 await dialog.evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:'output/playwright/onboarding-phase2-desktop.png'});
 await dialog.getByRole('button',{name:'Next attempts',exact:true}).click();
 await dialog.getByText('No server-confirmed save recorded',{exact:true}).first().waitFor();
 await dialog.getByText('Opened onboarding',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Previous attempts',exact:true}).click();
 await dialog.getByText('Microphone access denied',{exact:true}).waitFor();
 await page.setViewportSize({width:375,height:812});
 await dialog.locator('.admin-onboarding').scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/playwright/onboarding-phase2-mobile.png'});
 const overflow=await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1);if(overflow)throw new Error('Mobile timeline overflows dialog');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Earlier visitor',exact:true}).click();
 await dialog.getByText('No detailed attempts were recorded in this period.',{exact:false}).waitFor();
 await dialog.getByText('Signed in',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Close account details'}).click();
 await page.getByRole('button',{name:'Tracking unavailable',exact:true}).click();
 await dialog.getByText('Detailed tracking is not available yet.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Close account details'}).click();
 await page.getByRole('combobox',{name:'Test period'}).selectOption('7');
 await page.getByRole('button',{name:'Returning visitor',exact:true}).click();
 await dialog.getByText('Microphone access denied',{exact:true}).waitFor();
 if(!requests.some(r=>r.action==='onboarding-timeline'&&r.days===7))throw new Error('Period did not reach history request');
 deny=true;await dialog.getByRole('button',{name:'Next events',exact:true}).click();
 await page.getByText('Access denied',{exact:true}).waitFor();
 if(await page.getByRole('dialog').count())throw new Error('Protected details remained after access denied');
 console.log('Passed: retries, separate visits, saves, field flags, bilingual setup labels, event/attempt pagination, period selection, older/unavailable capture, mobile layout, Escape and access revocation.');
}
