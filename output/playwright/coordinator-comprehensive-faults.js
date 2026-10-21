// Three real HTTP saves whose successful responses are deliberately lost.
async page=>{
 await page.unrouteAll({behavior:'wait'});
 const origin='http://127.0.0.1:5174',fixture=await(await page.request.get(origin+'/tmp/coordinator-registration-browser.json')).json();
 const source=await(await page.request.get(origin+'/src/CoordinatorRegistration.tsx')).text(),auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 let actor='owner',drop='',dropped=0;const results=[];
 async function call(path,input){const r=await page.request.post(fixture.base+path,{headers:{'x-synthetic-actor':actor,'x-synthetic-secret':fixture.secret},data:input});const body=await r.json();if(!r.ok())throw Error(JSON.stringify(body));return body;}
 await page.route('**/api/**',async route=>{
  const input=route.request().postDataJSON(),path=new URL(route.request().url()).pathname;
  const r=await page.request.post(fixture.base+path,{headers:{'x-synthetic-actor':actor,'x-synthetic-secret':fixture.secret},data:input});
  if(input.action===drop&&r.status()===200){drop='';dropped++;await route.abort('connectionreset');return;}
  await route.fulfill({status:r.status(),contentType:'application/json',body:await r.text()});
 });
 await page.route('**/comprehensive-faults*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';
 import Registration from '/src/CoordinatorRegistration.tsx';import PrivateSession from '/src/PrivateSession.tsx';import '/src/styles.css';import '/src/brand.css';
 const sub=new URLSearchParams(location.search).get('actor');sessionStorage.setItem('origen-login-fresh','1');localStorage.setItem('origen.language','en');
 const auth={isAuthenticated:true,isLoading:false,user:{sub},getAccessTokenSilently:async()=>'synthetic',logout:async()=>{},loginWithRedirect:async()=>{}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(PrivateSession,null,React.createElement(Registration))));
 </script></body></html>`}));
 for(const [sub,action] of [['owner','submit-application'],['invited','register'],['legacy','submit']]){
  actor=sub;await page.goto(origin+'/comprehensive-faults?actor='+sub);
  for(const [label,value] of [['Your name','Fault '+sub],['Organization name','Fault organization '+sub],['Organization website (https://)','https://example.org/'],['Your role or job title','Advisor']])await page.getByRole('textbox',{name:label,exact:true}).fill(value);
  await page.getByRole('radio',{name:'Register my organization',exact:true}).check();
  await page.getByRole('textbox',{name:'What does your organization do?',exact:false}).fill('Synthetic recovery services.');await page.getByRole('checkbox').check();
  drop=action;await page.getByRole('button',{name:'Register and apply',exact:true}).click();await page.getByRole('alert').waitFor();
  const a=(await call('/api/coordinator-access',{action:'application-status'})).application;if(!a)throw Error('Application not saved');
  if(action==='submit-application'){
   await page.getByRole('button',{name:'Refresh status',exact:true}).click();
   await page.getByText('Need to register your organization? Do it here.',{exact:true}).click();
   await page.getByRole('textbox',{name:'What does your organization do?',exact:false}).fill('Synthetic recovery services.');await page.getByRole('checkbox').check();
   await page.getByRole('button',{name:'Register my organization',exact:true}).click();
  }else{
   await page.getByRole('button',{name:'Complete organization registration',exact:true}).click();
  }
  await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
  const org=(await call('/api/institutions',{action:'signup-status',applicationId:a.id})).organization;
  if(org.status!=='submitted')throw Error('Not submitted after recovery '+action);
  await page.reload();await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
  const again=(await call('/api/institutions',{action:'signup-status',applicationId:a.id})).organization;
  if(org.id!==again.id)throw Error('Organization changed on reload');
  results.push({action,passed:true,savedStatus:org.status});
 }
 return {passed:true,dropped,results};
}
