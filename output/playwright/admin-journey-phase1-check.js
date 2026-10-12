async page=>{
 const origin='http://127.0.0.1:5192',requests=[],errors=[];let fail=false,deny=false;
 page.on('pageerror',error=>errors.push(error.message));
 const stages=['registered','onboarding_started','save_unconfirmed','profile_saved','guidance_used'];
 const users=stages.map((journey_stage,i)=>({id:`11111111-1111-4111-8111-11111111111${i}`,first_name:['Operator','Getting started','Earlier account','Saved account','Returning parent'][i],role:i===0?null:i===4?'parent':'student',created_at:'2026-10-01T10:00:00Z',journey_stage,student_profiles:i===4?2:i>1?1:0,profile_details_present:i>1,profile_complete:i>2,onboarding_started_at:i?'2026-10-02T10:00:00Z':null,onboarding_completed_at:i>2?'2026-10-03T10:00:00Z':null,first_guidance_at:i===4?'2026-10-04T10:00:00Z':null,logins:1,last_login:'2026-10-02T10:00:00Z',last_activity_at:'2026-10-08T10:00:00Z',last_activity_kind:i===4?'voice_activity':'onboarding_receipt',voice_minutes:i===4?2:0,calls:i===4?1:0,admin_access:i===0?'confirmed':'not_verified'}));
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  if(deny)return route.fulfill({status:403,contentType:'application/json',body:'{"error":"admin_required"}'});
  let json,status=200;
  if(body.action==='users'){
   if(fail){status=503;json={error:'users_unavailable'};fail=false;}
   else{const selected=users.filter(user=>(body.journey==='all'||user.journey_stage===body.journey)&&(body.role==='all'||user.role===body.role||(body.role==='unknown'&&!user.role))&&user.first_name.toLowerCase().includes((body.search||'').toLowerCase()));json={users:selected,total:selected.length,page:1,pageSize:25,funnel:{measured_since:'2026-10-01T00:00:00Z',registered:5,started:4,completed:2,first_conversation:1,untracked:1}};}
  }else if(body.action==='user-detail')json={user:users.find(user=>user.id===body.id),activity:[]};
  else if(body.action==='user-history')json={events:[],total:0,page:1,pageSize:30,counts:{summaries:0,summary_failures:0},recap:{title:'Recorded history',lines:[]},window:{end:'2026-10-10T00:00:00Z'},coverage:{measuredSince:{},onboardingRetentionDays:90,guidanceEnabled:false}};
  else if(body.action==='onboarding-metrics')json={coverage:{available:false,measuredSince:null,retentionDays:90}};
  else if(body.action==='onboarding-alerts')json={available:false};
  else if(body.action==='onboarding-timeline')json={attempts:[],total:0,page:1,pageSize:5,coverage:{available:false,measuredSince:null,retentionDays:90,olderAccount:true}};
  else throw Error('Unexpected synthetic request');
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/AdminUsers.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/admin-journey-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminUsers from '/src/AdminUsers.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/admin.css';import '/src/brand.css';
 const getToken=async()=>'synthetic-token';setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'auth0|synthetic-admin'},getAccessTokenSilently:getToken};
 function Harness(){const [denied,setDenied]=React.useState(false);return denied?React.createElement('p',null,'Access denied'):React.createElement('div',{className:'admin-workspace'},React.createElement('main',{className:'admin-dashboard'},React.createElement('h1',null,'Registered users'),React.createElement(AdminUsers,{days:30,revision:0,onDenied:()=>setDenied(true)})));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Harness)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/admin-journey-harness');
 const table=page.getByRole('table',{name:'Account directory'});
 await table.getByRole('button',{name:'Earlier account',exact:true}).waitFor();
 if(!await table.getByText('Save unconfirmed',{exact:true}).isVisible())throw Error('Missing history was not distinguished');
 if(!await table.getByText('2 saved student profiles',{exact:true}).isVisible())throw Error('Student count missing');
 if(await table.getByText('Incomplete',{exact:true}).count())throw Error('Uncertain records labeled incomplete');
 await table.getByRole('button',{name:'Operator',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByText('Setup is optional for admins.',{exact:true}).waitFor();
 await dialog.getByText('Account reference',{exact:true}).click();await dialog.getByText('Admin access: Confirmed by the backend for this report',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close account details'}).click();
 await table.getByRole('button',{name:'Earlier account',exact:true}).click();await dialog.getByText('Account reference',{exact:true}).click();await dialog.getByText('Admin access: Not verified here · check Auth0',{exact:true}).waitFor();await dialog.getByText('Save unconfirmed',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close account details'}).click();
 await page.getByRole('combobox',{name:'Journey stage',exact:true}).selectOption('guidance_used');await table.getByRole('button',{name:'Returning parent',exact:true}).waitFor();if(await table.locator('tbody tr').count()!==1)throw Error('Journey filtering failed');
 await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('last_activity');await table.getByRole('button',{name:'Returning parent',exact:true}).waitFor();
 if(!requests.some(body=>body.action==='users'&&body.sort==='last_activity'&&body.journey==='guidance_used'&&body.page===1))throw Error('Filter/sort request incorrect');
 await page.getByRole('combobox',{name:'Journey stage',exact:true}).selectOption('all');await table.getByRole('button',{name:'Operator',exact:true}).waitFor();
 await table.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/admin-journey-phase1-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.getByRole('combobox',{name:'Journey stage',exact:true}).scrollIntoViewIfNeeded();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Page overflows on mobile');
 await page.screenshot({path:'output/playwright/admin-journey-phase1-mobile.png',fullPage:true});
 fail=true;await page.getByRole('combobox',{name:'Account-holder role',exact:true}).selectOption('parent');await page.getByRole('button',{name:'Retry users'}).click();await table.getByRole('button',{name:'Returning parent',exact:true}).waitFor();
 deny=true;await page.getByRole('combobox',{name:'Account-holder role',exact:true}).selectOption('student');await page.getByText('Access denied',{exact:true}).waitFor();if(await table.count())throw Error('User data remained visible after access denial');
 if(errors.length)throw Error(errors.join('; '));return {passed:true,stages:true,adminAccessSeparate:true,filters:true,retry:true,permissionRevocation:true,mobile:true};
}
