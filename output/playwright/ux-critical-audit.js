async page => {
 const results=[];
 const origin='http://127.0.0.1:5192';
 const baseStudents=[{id:'synthetic-sofia',name:'Sofía',stage:'Community college',interest:'Science',gpa:'',color:'lilac'},{id:'synthetic-mateo',name:'Mateo',stage:'10th grade',interest:'Art',gpa:'',color:'peach'}];
 let students=[...baseStudents],scenario='parent',heldGuide=[];
 await page.route('**/api/family',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='delete-student')students=students.filter(s=>s.id!==body.id);
  await route.fulfill({contentType:'application/json',body:JSON.stringify({account:scenario==='admin-outage'?{firstName:'',email:''}:{firstName:'Alex',role:scenario==='empty'?'student':'parent',email:'',welcomeHeard:true},students:scenario==='empty'||scenario==='admin-outage'?[]:students})});
 });
 await page.getByRole('button',{name:'Talk with Origen',exact:true}).first().click();
 await page.waitForFunction(()=>window.voiceFixture.connections===1);
 await page.waitForTimeout(250);
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'confirm-sofia',status:'completed',output:[{type:'function_call',name:'request_conversation_target',call_id:'confirm-sofia',arguments:JSON.stringify({scope:'student:synthetic-sofia'})}]}}));
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=>window.voiceFixture.messages.length);
 await page.locator('.home-student-selector button').filter({hasText:'Mateo'}).click();
 await page.waitForTimeout(350);
 const studentSwitch=await page.evaluate(before=>({newEvents:window.voiceFixture.messages.slice(before),connections:window.voiceFixture.connections,closed:window.voiceFixture.closed}),before);
 results.push({bug:'screen-student-switch-not-delivered',homeMateo:await page.locator('.home-student-selector button[aria-pressed=true]').innerText(),...studentSwitch});
 await page.locator('.home-student-selector button').filter({hasText:'Sofía'}).click();
 await page.locator('.home-person').getByRole('button',{name:'Edit profile'}).click();
 await page.getByRole('button',{name:'Delete student',exact:true}).click();
 const canDelete=await page.getByRole('button',{name:'Confirm deletion',exact:true}).isEnabled();
 await page.getByRole('button',{name:'Confirm deletion',exact:true}).click();
 await page.waitForTimeout(400);
 results.push({bug:'delete-student-does-not-stop-current-call',deleteEnabledDuringCall:canDelete,remaining:students.map(s=>s.id),voice:await page.evaluate(()=>({connections:window.voiceFixture.connections,closed:window.voiceFixture.closed})),endButtonPresent:await page.getByRole('button',{name:'End conversation',exact:true}).count()});
 scenario='empty';
 await page.goto(origin+'/sheet-workspace-harness?empty');
 await page.getByRole('heading',{name:'Hi, Alex.'}).waitFor();
 await page.waitForTimeout(300);
 results.push({ruledOut:'empty-profile-home',addMyProfile:await page.getByRole('button',{name:'Add my profile',exact:true}).count()});
 // Mount the actual account-entry component under a synthetic signed-in admin.
 const source=await(await page.request.get(origin+'/src/App.tsx')).text();
 const authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 scenario='admin-outage';
 await page.route('**/api/admin',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'database_unavailable'})}));
 await page.route('**/api/institutions',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({memberships:[],hasPersonalAccount:false})}));
 await page.route('**/entry-ux-harness*',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import Entry from '/src/Entry.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import '/src/styles.css';
 localStorage.clear();const subject='auth0|synthetic-admin',getToken=async()=>'test.'+btoa(JSON.stringify({sub:subject}))+'.test';browserPrivacy.start(subject,{fresh:true});
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:{isAuthenticated:true,isLoading:false,user:{sub:subject,roles:['admin']},getAccessTokenSilently:getToken,logout:async()=>{}}},React.createElement(Entry)));
 </script></body></html>`}));
 await page.goto(origin+'/entry-ux-harness#app');
 await page.locator('.welcome-conversation').waitFor();
 results.push({bug:'admin-outage-routes-to-onboarding',welcomeHeading:await page.locator('.welcome-story h1').innerText(),adminDashboard:await page.locator('.admin-shell').count()});
 await page.route('**/api/admin',()=>new Promise(()=>{}));
 await page.reload();
 await page.waitForTimeout(12000);
 results.push({bug:'account-entry-has-no-timeout-or-escape',status:await page.locator('main').innerText(),buttons:await page.locator('main button').count(),links:await page.locator('main a').count()});
 return results;
}
