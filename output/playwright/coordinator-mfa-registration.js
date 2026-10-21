async page=>{
 await page.unrouteAll({behavior:'wait'});
 const origin='http://127.0.0.1:5174',api='/api/coordinator-access',institutions='/api/institutions',errors=[],results=[];
 const fixture=await(await page.request.get(origin+'/tmp/coordinator-mfa-browser.json')).json();
 page.on('pageerror',e=>errors.push(e.message));
 const source=await(await page.request.get(origin+'/src/CoordinatorRegistration.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 async function mode(mode){const r=await page.request.post(fixture.control,{headers:{'x-synthetic-secret':fixture.secret},data:{mode}});if(r.status()!==200)throw Error('Fixture control failed');}
 async function call(sub,path,input){const r=await page.request.post(fixture.base+path,{headers:{'x-synthetic-actor':sub,'x-synthetic-secret':fixture.secret},data:input});const body=await r.json();if(r.status()!==200)throw Error(`${input.action}: ${r.status()} ${body.error}`);return body;}
 await page.route('**/api/**',async route=>{const r=await page.request.post(fixture.base+new URL(route.request().url()).pathname,{headers:{'x-synthetic-actor':'applicant','x-synthetic-secret':fixture.secret},data:route.request().postDataJSON()});await route.fulfill({status:r.status(),contentType:'application/json',body:await r.text()});});
 await page.route('**/mfa-browser*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';
 import Registration from '/src/CoordinatorRegistration.tsx';import Workspace from '/src/CoordinatorWorkspace.tsx';import PrivateSession from '/src/PrivateSession.tsx';
 import '/src/styles.css';import '/src/brand.css';import {setAPITokenProvider} from '/src/api.ts';setAPITokenProvider(async()=>'synthetic');
 window.redirects=[];window.tokenError=new URLSearchParams(location.search).get('tokenError')||'';window.redirectError=false;
 const params=new URLSearchParams(location.search);sessionStorage.setItem('origen-login-fresh','1');
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'applicant'},getAccessTokenSilently:async()=>{if(window.tokenError)throw Object.assign(new Error('Human-readable SDK description'),{error:window.tokenError});return 'synthetic';},logout:async()=>{},loginWithRedirect:async options=>{if(window.redirectError)throw Error('synthetic unavailable');window.redirects.push(options);}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(PrivateSession,null,params.has('workspace')?React.createElement(Workspace):React.createElement(Registration))));
 </script></body></html>`}));
 await page.setViewportSize({width:390,height:844});await mode('none');await page.goto(origin+'/mfa-browser');
 for(const [name,value] of [['Your name','Synthetic MFA Advisor'],['Organization name','Synthetic MFA Center'],['Organization website (https://)','https://example.org/'],['Your role or job title','Advisor']])await page.getByRole('textbox',{name,exact:true}).fill(value);
 await page.getByRole('radio',{name:'Register my organization',exact:true}).check();
 await page.getByRole('textbox',{name:'What does your organization do?',exact:false}).fill('Synthetic MFA recovery description.');await page.getByRole('checkbox').check();
 // Session expiry while filling the form must preserve fields before submission.
 await page.evaluate(()=>window.tokenError='login_required');
 await page.getByRole('button',{name:'Register and apply',exact:true}).click();
 await page.getByRole('button',{name:'Sign in again',exact:true}).click();
 await page.waitForFunction(()=>window.redirects.length===1);
 if((await call('applicant',api,{action:'application-status'})).application)throw Error('Expired session submitted application');
 await page.reload();
 await page.getByRole('button',{name:'Register and apply',exact:true}).waitFor();
 for(const [name,value] of [['Your name','Synthetic MFA Advisor'],['Organization name','Synthetic MFA Center'],['Organization website (https://)','https://example.org/'],['Your role or job title','Advisor']])if(await page.getByRole('textbox',{name,exact:true}).inputValue()!==value)throw Error('Lost draft field '+name);
 if(await page.getByRole('textbox',{name:'What does your organization do?',exact:false}).inputValue()!=='Synthetic MFA recovery description.'||!await page.getByRole('checkbox').isChecked())throw Error('Lost organization draft');
 results.push('Unsubmitted form and organization choice survive interactive sign-in.');
 await page.getByRole('button',{name:'Register and apply',exact:true}).click();
 await page.getByRole('heading',{name:'Verify your access',exact:true}).waitFor();
 const application=(await call('applicant',api,{action:'application-status'})).application;
 results.push('Application saved before enrollment; organization registration correctly stopped.');
 await page.evaluate(()=>window.redirectError=true);await page.getByRole('button',{name:'Verify my identity',exact:true}).click();
 await page.getByText('Sign-in could not open. Please try again.',{exact:true}).waitFor();
 await page.evaluate(()=>window.redirectError=false);await page.getByRole('button',{name:'Verify my identity',exact:true}).click();
 const redirects=await page.evaluate(()=>window.redirects);
 if(redirects.length!==1||redirects[0].appState.returnTo!=='#coordinator-register'||redirects[0].authorizationParams.max_age!==0||redirects[0].authorizationParams.prompt!=='login'||!redirects[0].authorizationParams.acr_values.includes('multi-factor'))throw Error('Wrong MFA redirect');
 await mode('fresh');await page.reload();
 await page.getByRole('button',{name:'Complete organization registration',exact:true}).click();
 await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
 const org=(await call('applicant',institutions,{action:'signup-status',applicationId:application.id})).organization;
 if(org.page.description!=='Synthetic MFA recovery description.'||org.status!=='submitted')throw Error('MFA redirect lost draft or submission');
 results.push('Real PrivateSession remount preserves organization draft after synthetic MFA return.');
 await call('reviewer',institutions,{action:'verify',id:org.id,revision:org.revision,note:'Synthetic affiliation review.'});await call('reviewer',api,{action:'approve-organization',id:org.id});await call('reviewer',api,{action:'approve-application',id:application.id,institutionId:org.id,reviewNote:'Synthetic independent review.'});
 await mode('stale-write');await page.goto(origin+'/mfa-browser?workspace=1');await page.getByRole('button',{name:'Create code',exact:true}).click();
 await page.getByRole('heading',{name:'Verify your access',exact:true}).waitFor();await page.getByRole('button',{name:'Verify my identity',exact:true}).click();
 const workspaceRedirects=await page.evaluate(()=>window.redirects);if(workspaceRedirects[0].appState.returnTo!=='#coordinators')throw Error('Wrong workspace return route');
 await mode('fresh');await page.reload();await page.getByRole('button',{name:'Create code',exact:true}).click();
 await page.getByRole('textbox',{name:'Save this code now',exact:true}).waitFor();results.push('Expired write verification preserves approved access; fresh verification allows first connection code.');
 await page.screenshot({path:'output/playwright/coordinator-mfa-workspace.png',fullPage:true});
 const sdkRecovery=[];
 for(const error of ['login_required','mfa_required','consent_required','interaction_required']){
  await page.goto(origin+'/mfa-browser');await page.getByRole('heading',{name:'Your application was approved',exact:true}).waitFor();
  await page.evaluate(error=>window.tokenError=error,error);await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await page.getByRole('button',{name:error==='mfa_required'?'Verify my identity':'Sign in again',exact:true}).click();
  await page.waitForFunction(()=>window.redirects.length===1);
  const redirect=await page.evaluate(()=>window.redirects[0]);
  if(redirect.appState.returnTo!=='#coordinator-register'||redirect.authorizationParams.max_age!==0||redirect.authorizationParams.prompt!=='login')throw Error('Wrong recovery redirect '+error);
  if(error==='mfa_required'&&!redirect.authorizationParams.acr_values.includes('multi-factor'))throw Error('MFA recovery did not request MFA');
  if(await page.getByRole('alert').count())throw Error('Recovery shows generic error '+error);
  sdkRecovery.push({error,returnedTo:redirect.appState.returnTo});
 }
 await page.goto(origin+'/mfa-browser?workspace=1&tokenError=login_required');
 await page.getByRole('button',{name:'Verify my identity',exact:true}).click();await page.waitForFunction(()=>window.redirects.length===1);
 if((await page.evaluate(()=>window.redirects[0])).appState.returnTo!=='#coordinators')throw Error('Wrong workspace SDK recovery route');
 await page.goto(origin+'/mfa-browser?tokenError=network_error');
 await page.getByRole('alert').waitFor();
 if(await page.getByRole('button',{name:/Sign in again|Verify my identity/}).count())throw Error('Network error incorrectly became authentication prompt');
 results.push('SDK codes recover interactively; network errors remain retryable without redirect.');
 if(errors.length)throw Error(errors.join('\n'));
 return {passed:true,syntheticAuth0:true,realOtpEnrollment:false,results,sdkRecovery,pageErrors:errors};
}
