async page=>{
 await page.unrouteAll({behavior:'wait'});
 const origin='http://127.0.0.1:5174',api='/api/coordinator-access',institutions='/api/institutions',errors=[];
 const {base,secret}=await(await page.request.get(origin+'/tmp/coordinator-registration-browser.json')).json();
 page.on('pageerror',e=>errors.push(e.message));
 const source=await(await page.request.get(origin+'/src/CoordinatorRegistration.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 let actor='applicant';
 async function call(sub,path,input){const r=await page.request.post(base+path,{headers:{'x-synthetic-actor':sub,'x-synthetic-secret':secret},data:input});const body=await r.json();if(r.status()!==200)throw Error(`${input.action}: ${r.status()} ${body.error}`);return body;}
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const r=await page.request.post(base+path,{headers:{'x-synthetic-actor':actor,'x-synthetic-secret':secret},data:route.request().postDataJSON()});
  await route.fulfill({status:r.status(),contentType:'application/json',body:await r.text()});
 });
 await page.route('**/registration-e2e*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';
 import Registration,{CoordinatorApplications} from '/src/CoordinatorRegistration.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';
 import Workspace from '/src/CoordinatorWorkspace.tsx';
 import {setAPITokenProvider} from '/src/api.ts';setAPITokenProvider(async()=>'synthetic');
 const params=new URLSearchParams(location.search),review=params.has('review'),sub=review?'reviewer':'applicant';localStorage.setItem('origen.language',params.get('lang')||'en');browserPrivacy.start(sub,{fresh:true});
 const auth={isAuthenticated:true,isLoading:false,user:{sub},getAccessTokenSilently:async()=>'synthetic',logout:async()=>browserPrivacy.stop('logout'),loginWithRedirect:async()=>{}};
 const request=async input=>{const r=await fetch('/api/coordinator-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
 function Review(){const [error,setError]=React.useState('');return React.createElement('main',{className:'coordinator-workspace'},error&&React.createElement('p',{role:'alert'},error),React.createElement(CoordinatorApplications,{request,t:(en,es)=>en,onError:setError}));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},review?React.createElement(Review):params.has('workspace')?React.createElement(Workspace):React.createElement(Registration)));
 </script></body></html>`}));
 await page.setViewportSize({width:390,height:844});
 await page.goto(origin+'/registration-e2e');
 for(const [label,value] of [['Your name','Browser Test Advisor'],['Organization name','Browser Community Center'],['Organization website (https://)','https://example.org/'],['Your role or job title','Advisor']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('radio',{name:'Register my organization',exact:true}).check();
 await page.getByLabel('What does your organization do?',{exact:false}).fill('College and transfer guidance.');
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Register and apply',exact:true}).click();
 await page.getByRole('heading',{name:'Your application is awaiting review',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
 const application=(await call('applicant',api,{action:'application-status'})).application;
 let org=(await call('applicant',institutions,{action:'signup-status',applicationId:application.id})).organization;
 if(org.status!=='submitted')throw Error('Organization not submitted');
 await call('reviewer',institutions,{action:'request-changes',id:org.id,revision:org.revision,note:'Please describe your transfer services.'});
 // Clear browser drafts to simulate returning on another device.
 await page.evaluate(()=>sessionStorage.clear());await page.reload();
 await page.getByText('Please describe your transfer services.',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'What does your organization do?',exact:true}).fill('College guidance and transfer application preparation.');
 await page.getByRole('button',{name:'Save and send for review',exact:true}).click();
 await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
 org=(await call('applicant',institutions,{action:'signup-status',applicationId:application.id})).organization;
 if(org.page.description!=='College guidance and transfer application preparation.')throw Error('Correction not persisted');
 await call('reviewer',institutions,{action:'verify',id:org.id,revision:org.revision,note:'Organization affiliation verified.'});
 await call('reviewer',api,{action:'approve-organization',id:org.id});
 await page.screenshot({path:'output/coordinator-comprehensive-2026-10-21/coordinator-registration-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile horizontal overflow');
 actor='reviewer';await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/registration-e2e?review=1');
 await page.getByRole('button',{name:'Refresh applications',exact:true}).click();
 await page.getByRole('button',{name:'Review',exact:true}).click();
 await page.getByLabel('Find an organization',{exact:true}).fill('Browser Community');
 await page.getByRole('button',{name:'Search organizations',exact:true}).click();
 await page.getByRole('combobox',{name:'Verified organization',exact:true}).selectOption(org.id);
 await page.getByRole('textbox',{name:'Message the applicant will see',exact:true}).fill('Your affiliation has been confirmed. Welcome.');
 await page.getByRole('button',{name:'Approve coordinator access',exact:true}).click();
 await page.getByText('No pending applications on this page.',{exact:true}).waitFor();
 actor='applicant';await page.goto(origin+'/registration-e2e');
 await page.getByRole('heading',{name:'Your application was approved',exact:true}).waitFor();
 await page.getByRole('link',{name:'Open coordinator workspace',exact:true}).waitFor();
 const profile=(await call('applicant',api,{action:'profile',id:org.id})).profile;
 if(profile.status!=='active')throw Error('Approved workspace access failed');
 await page.screenshot({path:'output/coordinator-comprehensive-2026-10-21/coordinator-registration-approved.png',fullPage:true});
 await page.goto(origin+'/registration-e2e?workspace=1');
 await page.getByRole('heading',{name:'Your coordinator workspace',exact:true}).waitFor();
 await page.getByRole('button',{name:'Create code',exact:true}).click();
 const code=await page.getByRole('textbox',{name:'Save this code now',exact:true}).inputValue();
 if(!/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code))throw Error('Workspace did not create a valid code');
 await page.getByRole('img',{name:'Connection code QR',exact:true}).waitFor();
 if(await page.getByRole('alert').count())throw Error('Workspace has an error');
 await page.goto(origin+'/registration-e2e?lang=es',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Tu solicitud fue aprobada',exact:true}).waitFor();
 if(errors.length)throw Error(errors.join('\n'));
 return {passed:true,mobileSignup:true,draftRecovery:true,corrections:true,reviewerSearchAndApproval:true,workspaceCodeAndQR:true,spanishStatus:true,pageErrors:errors};
}

