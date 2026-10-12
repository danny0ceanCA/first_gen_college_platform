async page=>{
 const origin='http://127.0.0.1:5192',requests=[],errors=[];let fail=false,deny=false,cutoff=0,slow=false;
 page.on('pageerror',error=>errors.push(error.message));
 const user={id:'11111111-1111-4111-8111-111111111111',first_name:'Sample parent',role:'parent',created_at:'2026-10-01T10:00:00Z',journey_stage:'profile_saved',student_profiles:2,profile_details_present:true,profile_complete:true,onboarding_started_at:'2026-10-02T10:00:00Z',onboarding_completed_at:'2026-10-03T10:00:00Z',first_guidance_at:null,logins:3,last_login:'2026-10-08T10:00:00Z',last_activity_at:'2026-10-09T10:00:00Z',last_activity_kind:'voice_activity',voice_minutes:7.5,calls:2,admin_access:'not_verified'};
 const special=[
  {kind:'summary_stored',category:'summaries',title:'Conversation summary stored',note:'Planning · a summary record is currently stored. This is its first storage time, which may differ from the conversation time.'},
  {kind:'voice_call',category:'voice',title:'Planning conversation',note:'Starting topic · 4 recorded connected minutes. No end receipt recorded by the cutoff; this does not mean the call is active.'},
  {kind:'home_reached',category:'onboarding',title:'Home page reached',note:'The browser reported arriving at the web home page.',evidence:'browser'},
  {kind:'profile_saved',category:'onboarding',title:'Profile saved',note:'The server confirmed the profile save.'},
  {kind:'save_failed',category:'onboarding',title:'Profile save request failed',note:'The browser reported a failed save request. A later save may have succeeded.',evidence:'browser',problem:true},
  {kind:'onboarding_visit',category:'onboarding',title:'Onboarding visit recorded',note:'Another visit was recorded for this account.'}
 ];
 const events=Array.from({length:36},(_,i)=>({id:String(i),kind:'sign_in',category:'access',title:'Signed in',note:'A successful web sign-in return was recorded.',problem:false,evidence:'server',recordedAt:new Date(Date.UTC(2026,9,9,20-i/2)).toISOString(),occurredAt:null,attemptId:null,...(special[i]||{})}));
 const recap={title:'Profile save confirmed',lines:['The account has a server-confirmed setup completion.','2 onboarding visits and 2 conversation records in this period.','The browser reported reaching the home page in this period.','1 stored summary record first saved in this period.','1 recorded problem signal; this does not establish that it is still unresolved.']};
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  if(deny)return route.fulfill({status:403,contentType:'application/json',body:'{"error":"admin_required"}'});
  let json;
  if(body.action==='users')json={users:[user],total:1,page:1,pageSize:25,funnel:{measured_since:'2026-10-01T00:00:00Z',registered:1,started:1,completed:1,first_conversation:0,untracked:0}};
  else if(body.action==='user-detail'){
   if(slow){slow=false;await new Promise(resolve=>setTimeout(resolve,500));}
   json={user,activity:[]};
  }else if(body.action==='user-history'){
   if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"user_history_unavailable"}'});}
   const selected=events.filter(e=>body.category==='all'||e.category===body.category||(body.category==='problems'&&e.problem));
   json={events:selected.slice((body.page-1)*30,body.page*30),counts:{summaries:1,summary_failures:0},recap,total:selected.length,page:body.page,pageSize:30,category:body.category,window:{days:body.days,start:'2026-09-10T00:00:00Z',end:body.asOf||new Date(Date.UTC(2026,9,10,0,cutoff++)).toISOString()},coverage:{measuredSince:{'027_onboarding_events.sql':'2026-10-01T00:00:00Z'},onboardingRetentionDays:90,guidanceEnabled:false}};
  }else if(body.action==='onboarding-metrics')json={coverage:{available:false,measuredSince:null,retentionDays:90}};
  else if(body.action==='onboarding-alerts')json={available:false};
  else if(body.action==='onboarding-timeline')json={attempts:[],total:0,page:1,pageSize:5,coverage:{available:false,measuredSince:null,retentionDays:90,olderAccount:true}};
  else throw Error('Unexpected synthetic request '+body.action);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/AdminUsers.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/admin-user-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminUsers from '/src/AdminUsers.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/admin.css';import '/src/brand.css';
 const getToken=async()=>'synthetic-token';setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'auth0|synthetic-admin'},getAccessTokenSilently:getToken};
 function Harness(){const [denied,setDenied]=React.useState(false);return denied?React.createElement('p',null,'Access denied'):React.createElement('div',{className:'admin-workspace'},React.createElement('main',{className:'admin-dashboard'},React.createElement('h1',null,'Registered users'),React.createElement(AdminUsers,{days:30,revision:0,onDenied:()=>setDenied(true)})));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Harness)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1050});await page.goto(origin+'/admin-user-harness');
 const table=page.getByRole('table',{name:'Account directory'}),opener=table.getByRole('button',{name:'Sample parent',exact:true}),dialog=page.getByRole('dialog');
 await opener.waitFor();await page.getByRole('searchbox',{name:'Search name or user ID'}).fill('Sample');await page.waitForTimeout(400);await opener.click();
 await dialog.getByRole('heading',{name:'Profile save confirmed',exact:true}).waitFor();
 if(requests.some(r=>r.action==='onboarding-timeline'))throw Error('Detailed diagnostics should load on demand');
 if(!await dialog.getByRole('button',{name:'Close account details'}).evaluate(el=>el===document.activeElement))throw Error('Initial focus not on close control');
 await page.keyboard.press('Shift+Tab');if(!await dialog.evaluate(el=>el.contains(document.activeElement)))throw Error('Focus escaped modal');
 await dialog.getByText('Account reference',{exact:true}).click();await dialog.getByText('Admin access: Not verified here · check Auth0',{exact:true}).waitFor();
 await dialog.getByText('Account reference',{exact:true}).click();
 await page.screenshot({path:'output/playwright/admin-user-phase2-desktop.png'});
 const oldCutoff=requests.filter(r=>r.action==='user-history').at(-1).asOf;
 await dialog.getByRole('button',{name:'Older journey events'}).click();await dialog.getByText('Page 2',{exact:true}).waitFor();
 const paged=requests.filter(r=>r.action==='user-history').at(-1);if(paged.page!==2||!paged.asOf)throw Error('Paged history did not freeze cutoff');
 await dialog.getByRole('combobox',{name:'Show events'}).selectOption('problems');await dialog.getByText('Profile save request failed',{exact:true}).waitFor();
 if(await dialog.locator('.admin-unified-events>li').count()!==1)throw Error('Problems filter incorrect');
 if(requests.filter(r=>r.action==='user-history').at(-1).asOf!==paged.asOf)throw Error('Filter changed history cutoff');
 await dialog.getByRole('heading',{name:'Profile save confirmed',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Open detailed onboarding diagnostics'}).click();await dialog.getByText('Detailed tracking is not available yet.',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});if(!await opener.evaluate(el=>el===document.activeElement))throw Error('Focus was not restored');
 if(await page.getByRole('searchbox',{name:'Search name or user ID'}).inputValue()!=='Sample')throw Error('Directory filter was lost');
 // Closing while detail is loading must not reopen or repopulate the view.
 slow=true;await opener.click();await dialog.getByText('Loading account…',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(650);if(await dialog.count())throw Error('Late detail response reopened drawer');
 fail=true;await opener.click();await dialog.getByRole('button',{name:'Retry history'}).click();await dialog.getByRole('heading',{name:'Profile save confirmed',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Older journey events'}).click();await dialog.getByText('Page 2',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Refresh user view'}).click();await dialog.getByText('Page 1',{exact:true}).waitFor();if(requests.filter(r=>r.action==='user-history').at(-1).asOf!==undefined)throw Error('Refresh kept the old snapshot');
 await page.setViewportSize({width:390,height:844});await dialog.locator('.admin-user-drawer-body').evaluate(el=>el.scrollTop=0);
 if(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1))throw Error('Mobile drawer overflows');
 if(!await dialog.getByRole('button',{name:'Close account details'}).isVisible())throw Error('Mobile close control hidden');
 await page.screenshot({path:'output/playwright/admin-user-phase2-mobile.png'});
 await dialog.getByRole('heading',{name:'Journey timeline'}).scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/admin-user-phase2-mobile-timeline.png'});
 await dialog.getByRole('combobox',{name:'Show events'}).selectOption('summaries');await dialog.getByText('Conversation summary stored',{exact:true}).waitFor();
 if(await dialog.locator('.admin-unified-events>li').count()!==1)throw Error('Summary filter incorrect');
 deny=true;await dialog.getByRole('button',{name:'Refresh user view'}).click();await page.getByText('Access denied',{exact:true}).waitFor();if(await dialog.count())throw Error('Detail remained after access denial');
 if(errors.length)throw Error(errors.join('; '));return {passed:true,paging:true,stableCutoff:true,filters:true,recap:true,focusRestoration:true,lateResponse:true,retry:true,mobile:true,revocation:true};
}
