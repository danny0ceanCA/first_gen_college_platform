async page=>{
 const origin='http://127.0.0.1:5174',org='00000000-0000-4000-8000-000000000001';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const source=await(await page.request.get(origin+'/src/CoordinatorRegistration.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 let application=null;const calls=[];
 await page.route('**/api/**',async route=>{
  const input=route.request().postDataJSON();calls.push(input);let json={ok:true};
  if(input.action==='submit-application')application={...input,id:org,email:'synthetic@example.org',status:'pending',reviewNote:''};
  if(input.action==='withdraw-application')application=null;
  if(['submit-application','withdraw-application','application-status'].includes(input.action))json={application};
  if(input.action==='applications')json={applications:[{id:org,displayName:'Synthetic Coordinator',email:'synthetic@example.org',organizationName:'Community Futures',organizationWebsite:'https://example.org',jobRole:'Advisor',status:'pending'}]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(json)});
 });
 await page.route('**/registration-preview*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';
 import Registration,{CoordinatorApplications} from '/src/CoordinatorRegistration.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';
 const query=new URLSearchParams(location.search);localStorage.setItem('origen.language',query.get('lang')||'en');browserPrivacy.start('synthetic-coordinator',{fresh:true});
 const auth={isAuthenticated:!query.has('anonymous'),isLoading:false,user:{sub:'synthetic-coordinator'},getAccessTokenSilently:async()=>'synthetic',logout:async()=>{},loginWithRedirect:async()=>{}};
 const reviewer=React.createElement('main',{className:'institution-shell coordinator-workspace'},React.createElement(CoordinatorApplications,{t:(en,es)=>query.get('lang')==='es'?es:en,organizations:[{id:'${org}',name:'Community Futures',pilotStatus:'active',verificationStatus:'verified'}],request:async input=>{const r=await fetch('/api/coordinator-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return r.json();},onError:message=>{if(message)throw new Error(message);}}));
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},query.has('reviewer')?reviewer:React.createElement(Registration)));
 </script></body></html>`}));
 const results=[];
 for(const lang of ['en','es'])for(const width of [390,1280]){
  application=null;await page.setViewportSize({width,height:900});await page.goto(origin+'/registration-preview?lang='+lang);
  await page.getByLabel(lang==='en'?'Your name':'Tu nombre',{exact:true}).fill('Synthetic Coordinator');
  await page.getByLabel(lang==='en'?'Organization name':'Nombre de la organización',{exact:true}).fill('Community Futures');
  await page.getByLabel(lang==='en'?'Organization website (https://)':'Sitio web de la organización (https://)',{exact:true}).fill('https://example.org');
  await page.getByLabel(lang==='en'?'Your role or job title':'Tu función o cargo',{exact:true}).fill('Advisor');
  await page.getByRole('button',{name:lang==='en'?'Submit for review':'Enviar para revisión',exact:true}).click();
  await page.getByRole('heading',{name:lang==='en'?'Your application is awaiting review':'Tu solicitud está pendiente de revisión',exact:true}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Registration overflow '+width+lang);
  if(lang==='en'&&width===390)await page.screenshot({path:'output/playwright/coordinator-registration-mobile.png',fullPage:true});
  application={...application,status:'approved',reviewNote:'Affiliation verified.'};
  await page.getByRole('button',{name:lang==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await page.getByRole('link',{name:lang==='en'?'Open coordinator workspace':'Abrir espacio del coordinador',exact:true}).waitFor();
  await page.goto(origin+'/registration-preview?reviewer=1&lang='+lang);
  await page.getByRole('button',{name:lang==='en'?'Refresh applications':'Actualizar solicitudes',exact:true}).click();
  await page.getByRole('button',{name:lang==='en'?'Review':'Revisar',exact:true}).click();
  await page.getByRole('combobox',{name:lang==='en'?'Verified organization':'Organización verificada',exact:true}).selectOption(org);
  await page.getByLabel(lang==='en'?'Message the applicant will see':'Mensaje que verá la persona',{exact:true}).fill('Affiliation verified independently.');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Reviewer overflow '+width+lang);
  if(lang==='en'&&width===1280)await page.screenshot({path:'output/playwright/coordinator-registration-review.png',fullPage:true});
  await page.getByRole('button',{name:lang==='en'?'Approve coordinator access':'Aprobar acceso de coordinador',exact:true}).click();
  await page.getByRole('button',{name:lang==='en'?'Review':'Revisar',exact:true}).waitFor();
  results.push({lang,width,passed:true});
 }
 await page.goto(origin+'/registration-preview?anonymous=1');
 await page.getByRole('button',{name:'Register as a coordinator',exact:true}).waitFor();
 if(errors.length)throw new Error(errors.join(';'));
 return {results,submissions:calls.filter(c=>c.action==='submit-application').length,approvals:calls.filter(c=>c.action==='approve-application').length,errors};
}
