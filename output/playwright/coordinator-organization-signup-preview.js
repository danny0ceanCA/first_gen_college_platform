async page=>{
 const origin='http://127.0.0.1:5174',id='00000000-0000-4000-8000-000000000001';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const source=await(await page.request.get(origin+'/src/CoordinatorRegistration.tsx')).text();
 const auth=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 let application=null,mfa=false,failSubmit=false;let calls=[],organizations=new Map();
 await page.route('**/api/**',async route=>{
  const input=route.request().postDataJSON();calls.push({path:new URL(route.request().url()).pathname,...input});
  let json={ok:true},status=200;
  if(route.request().url().endsWith('/api/coordinator-access')){
   if(input.action==='submit-application')application={...input,organizationWebsite:new URL(input.organizationWebsite).href,id:crypto.randomUUID(),email:'synthetic@example.org',status:'pending',reviewNote:''};
   if(input.action==='withdraw-application')application=null;
   json={application};
  }else if(!mfa){status=403;json={error:'staff_mfa_required'};}
  else if(input.action==='signup-status')json={organization:organizations.get(input.applicationId)||null};
  else if(input.action==='save'){
   const org=[...organizations.values()].find(o=>o.id===input.id);org.page=input.page;org.revision++;org.status='draft';json={institutions:[org]};
  }else if(input.action==='register'){
   if(!organizations.has(input.registrationKey))organizations.set(input.registrationKey,{id,revision:1,status:'draft',membershipRole:'owner',page:input.page});
   json={registeredInstitutionId:id,institutions:[organizations.get(input.registrationKey)]};
  }else if(input.action==='submit'){
   if(failSubmit){failSubmit=false;return route.abort('failed');}
   for(const org of organizations.values())org.status='submitted';
   json={institutions:[...organizations.values()]};
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 await page.route('**/combined-preview*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${auth}';
 import Registration from '/src/CoordinatorRegistration.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';
 const query=new URLSearchParams(location.search);localStorage.setItem('origen.language',query.get('lang')||'en');browserPrivacy.start('synthetic-coordinator',{fresh:true});
 const auth={isAuthenticated:!query.has('anonymous'),isLoading:false,user:{sub:'synthetic-coordinator'},getAccessTokenSilently:async()=>'synthetic',logout:async()=>{browserPrivacy.stop('logout');},loginWithRedirect:async options=>{window.testLogin=options;}};
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Registration)));
 </script></body></html>`}));
 const results=[];
 async function fill(lang){
  for(const [en,es,value] of [['Your name','Tu nombre','Synthetic Coordinator'],['Organization name','Nombre de la organización','Community Futures'],['Organization website (https://)','Sitio web de la organización (https://)','https://example.org'],['Your role or job title','Tu función o cargo','Advisor']])await page.getByLabel(lang==='en'?en:es,{exact:true}).fill(value);
 }
 async function reset(lang,width){
  application=null;calls=[];organizations=new Map();mfa=false;failSubmit=false;
  await page.goto(origin+'/combined-preview?lang='+lang);await page.evaluate(()=>sessionStorage.clear());await page.reload();
  await page.setViewportSize({width,height:900});await fill(lang);
 }
 for(const lang of ['en','es'])for(const width of [390,1280]){
  await reset(lang,width);
  await page.getByRole('button',{name:lang==='en'?'Submit for review':'Enviar para revisión',exact:true}).click();
  await page.getByRole('heading',{name:lang==='en'?'Your application is awaiting review':'Tu solicitud está pendiente de revisión',exact:true}).waitFor();
  if(calls.some(c=>c.action==='register'))throw Error('Join path registered an organization');
  results.push({lang,width,path:'join',passed:true});
  await reset(lang,width);
  await page.getByRole('radio',{name:lang==='en'?'Register my organization':'Registrar mi organización',exact:true}).check();
  await page.getByLabel(lang==='en'?'What does your organization do?':'¿Qué hace tu organización?',{exact:false}).fill('College and transfer support for local students.');
  if(lang==='en'&&width===390)await page.screenshot({path:'tmp/coordinator-combined-form.png',fullPage:true});
  await page.getByRole('button',{name:lang==='en'?'Register and apply':'Registrar y solicitar acceso',exact:true}).click();
  if(application)throw Error('Authorization checkbox was not required');
  await page.getByRole('checkbox',{name:lang==='en'?'I’m authorized to register this organization and manage its team.':'Tengo autorización para registrar esta organización y gestionar su equipo.',exact:true}).check();
  await page.getByRole('button',{name:lang==='en'?'Register and apply':'Registrar y solicitar acceso',exact:true}).click();
  await page.getByRole('button',{name:lang==='en'?'Verify my identity':'Verificar mi identidad',exact:true}).waitFor();
  if(organizations.size)throw Error('MFA-denied request created an organization');
  await page.getByRole('button',{name:lang==='en'?'Verify my identity':'Verificar mi identidad',exact:true}).click();
  const login=await page.evaluate(()=>window.testLogin);
  if(login.appState.returnTo!=='#coordinator-register'||!login.authorizationParams.acr_values.includes('multi-factor'))throw Error('Wrong verification redirect');
  mfa=true;failSubmit=true;await page.reload();
  await page.getByRole('button',{name:lang==='en'?'Complete organization registration':'Completar registro de organización',exact:true}).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:lang==='en'?'Complete organization registration':'Completar registro de organización',exact:true}).click();
  await page.getByRole('heading',{name:lang==='en'?'Organization registered':'Organización registrada',exact:true}).waitFor();
  if(organizations.size!==1||organizations.values().next().value.status!=='submitted')throw Error('Retry created duplicates or missed review submission');
  if(new Set(calls.filter(c=>c.action==='register').map(c=>c.registrationKey)).size!==1)throw Error('Retry changed idempotency key');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+lang+width);
  const registeredCalls=calls.filter(c=>c.action==='register').length;
  await page.reload();await page.getByRole('heading',{name:lang==='en'?'Organization registered':'Organización registrada',exact:true}).waitFor();
  if(calls.filter(c=>c.action==='register').length!==registeredCalls)throw Error('Reload performed another mutation');
  await page.getByRole('button',{name:lang==='en'?'Log out':'Cerrar sesión',exact:true}).click();await page.reload();
  await page.getByRole('heading',{name:lang==='en'?'Organization registered':'Organización registrada',exact:true}).waitFor();
  if(organizations.size!==1||await page.getByText('Need to register your organization? Do it here.',{exact:true}).count())throw Error('Logout lost server registration');
  for(const org of organizations.values()){org.status='changes-requested';org.reviews=[{action:'request-changes',revision:org.revision,note:'Please clarify your services.'}];}
  await page.getByRole('button',{name:lang==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await page.getByText('Please clarify your services.',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:lang==='en'?'What does your organization do?':'¿Qué hace tu organización?',exact:true}).fill('Updated guidance services.');
  await page.getByRole('button',{name:lang==='en'?'Save and send for review':'Guardar y enviar a revisión',exact:true}).click();
  await page.getByRole('heading',{name:lang==='en'?'Organization registered':'Organización registrada',exact:true}).waitFor();
  if(organizations.values().next().value.page.description!=='Updated guidance services.')throw Error('Correction was not saved');
  results.push({lang,width,path:'new',mfaReturn:true,networkRetry:true,passed:true});
 }
 await reset('en',390);mfa=false;
 await page.getByRole('radio',{name:'Register my organization',exact:true}).check();
 await page.getByLabel('What does your organization do?',{exact:false}).fill('Original organization.');await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Register and apply',exact:true}).click();await page.getByRole('button',{name:'Verify my identity',exact:true}).waitFor();
 await page.evaluate(()=>{window.confirm=()=>true;});await page.getByRole('button',{name:'Withdraw application',exact:true}).click();
 await page.getByLabel('Organization name',{exact:true}).fill('Replacement organization');
 await page.getByRole('radio',{name:'Register my organization',exact:true}).check();await page.getByLabel('What does your organization do?',{exact:false}).fill('Replacement description.');await page.getByRole('checkbox').check();
 mfa=true;await page.getByRole('button',{name:'Register and apply',exact:true}).click();await page.getByRole('heading',{name:'Organization registered',exact:true}).waitFor();
 if(organizations.size!==1||organizations.values().next().value.page.name!=='Replacement organization')throw Error('Withdrawal reused stale organization');
 results.push({path:'withdraw-reapply',passed:true});
 await page.getByRole('button',{name:'Log out',exact:true}).click();
 if(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.includes('coordinator-organization'))))throw Error('Logout retained private organization draft');
 for(const lang of ['en','es'])for(const width of [320,768]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/combined-preview?anonymous=1&lang='+lang);
  await page.getByRole('button',{name:lang==='en'?'Register as a coordinator':'Registrarme como coordinador',exact:true}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Public overflow');
 }
 if(errors.length)throw Error(errors.join(';'));
 return {results,privacy:'logout cleared draft',errors};
}
