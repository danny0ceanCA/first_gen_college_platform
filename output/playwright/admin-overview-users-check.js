async page=>{
 const origin='http://127.0.0.1:5194',errors=[];let limited=false,denied=false;
 page.on('pageerror',e=>errors.push(e.message));
 const users=Array.from({length:10},(_,i)=>({id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,first_name:i===1?'':i===0?'Sample parent':`Sample user ${i+1}`,created_at:'2026-10-16T10:00:00Z',last_login:i===1?null:'2026-10-16T12:00:00Z',logins:'3',voice_minutes:'7.5'}));
 await page.route('**/api/admin',async route=>{
  const body=route.request().postDataJSON();let json;
  if(denied)return route.fulfill({status:403,json:{error:'admin_required'}});
  if(body.action==='access')json={admin:true,actions:limited?['overview']:['overview','users','user-detail','user-history'],permissions:limited?['read:activity']:['read:activity','read:users']};
  else if(body.action==='overview')json={totals:{users:'10',new_users:'2',active_users:'3',voice_minutes:'7.5',logins:'3',calls:'1'},users:limited?[]:users,activity:[],series:[],generatedAt:'2026-10-16T12:00:00Z',window:{days:30}};
  else if(body.action==='user-detail')json={user:{...users[0],role:'parent',journey_stage:'profile_saved',student_profiles:1,onboarding_completed_at:'2026-10-16T10:00:00Z'},activity:[]};
  else if(body.action==='user-history')json={events:[],counts:{summaries:0},recap:{title:'Profile saved',lines:['Synthetic record only.']},total:0,page:1,pageSize:30,window:{end:'2026-10-16T12:00:00Z'},coverage:{measuredSince:{},onboardingRetentionDays:90,guidanceEnabled:false}};
  else if(body.action==='users')json={users:[],total:0,page:1,pageSize:25,funnel:{measured_since:null,registered:0,started:0,completed:0,first_conversation:0,untracked:0}};
  else throw Error('Unexpected action '+body.action);
  return route.fulfill({json});
 });
 const source=await(await page.request.get(origin+'/src/AdminDashboard.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/admin-overview-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminDashboard from '/src/AdminDashboard.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/brand.css';
 import {browserPrivacy} from '/src/browserPrivacy.mjs';browserPrivacy.start('synthetic-admin',{fresh:true});
 const getToken=async()=>'synthetic-token';setAPITokenProvider(getToken);const auth={isAuthenticated:true,isLoading:false,user:{sub:'synthetic-admin'},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(AdminDashboard)));
 </script></body></html>`}));
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/admin-overview-harness');
  const list=page.getByRole('region',{name:'Your users'});await list.getByRole('button',{name:'Sample parent',exact:true}).waitFor();
  check(await list.locator('li').count()===8,'Preview must show eight newest accounts');
  check(await list.getByText('Account 11111111',{exact:true}).count()===1,'Nameless account reference missing');
  await list.getByRole('button',{name:'Sample parent',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Sample parent',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await list.scrollIntoViewIfNeeded();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows horizontally');
  await page.screenshot({path:`output/playwright/admin-overview-users-${width}.png`,fullPage:true});
  await list.getByRole('button',{name:'View all users'}).click();await page.getByRole('heading',{name:'Registered users',exact:true}).waitFor();
 }
 limited=true;await page.goto(origin+'/admin-overview-harness');await page.getByText('Current total · all time',{exact:true}).waitFor();check(await page.getByRole('region',{name:'Your users'}).count()===0,'Aggregate-only access exposed people');
 limited=false;await page.reload();await page.getByRole('region',{name:'Your users'}).waitFor();denied=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor();check(await page.getByRole('region',{name:'Your users'}).count()===0,'Denial must clear people');
 check(errors.length===0,errors.join('; '));return {passed:true,desktop:true,mobile:true,detailNavigation:true,directoryNavigation:true,restrictedAccess:true,denialClearsData:true};
}
