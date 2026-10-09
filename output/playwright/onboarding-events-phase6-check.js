async page=>{
 const origin='http://127.0.0.1:5178',batches=[],errors=[];let loadFailed=true,saveFailed=true,logouts=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 let family={account:{firstName:'',email:''},students:[]};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();let status=200,json={ok:true};
  if(path==='/api/onboarding-events')batches.push(body);
  else if(path==='/api/family'){
   if(body.action==='load'&&loadFailed){status=503;json={error:'synthetic_load_failure'};}
   else if(body.action==='complete-onboarding'&&saveFailed){status=503;json={error:'synthetic_save_failure'};}
   else{if(body.action==='complete-onboarding')family={account:body.account,students:body.student?[body.student]:[]};json=family;}
  }else if(path==='/api/conversation-history')json={items:[]};
  else if(path==='/api/conversation-overview')json={summary:'',sources:[],date:null};
  else if(path==='/api/phase6-logout')logouts++;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/App.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/phase6-test-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import App from '/src/App.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';
 const subject='auth0|synthetic-phase6',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{await fetch('/api/phase6-logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});throw Error('Synthetic logout failure');}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.route('**/phase6-storage',route=>route.fulfill({contentType:'text/html',body:'<html><body>Local synthetic storage</body></html>'}));
 await page.goto(origin+'/phase6-storage');await page.evaluate(()=>{
  const subject='auth0|synthetic-phase6';localStorage.setItem('origen.language','es');
  localStorage.setItem(`origen.onboarding.${subject}.v1`,JSON.stringify({version:1,at:Date.now(),value:{name:'Private Ana',role:'parent',step:'voice',draft:{id:'phase6-student',name:'Private Luis',stage:'Community college',school:'Private school',interest:'',gpa:'',color:'lilac'}}}));
  localStorage.setItem(`origen.user.${subject}.onboarding-events.11111111-1111-4111-8111-111111111111`,JSON.stringify({version:1,events:[{sequence:1,name:'onboarding_opened',occurredAt:new Date().toISOString(),metadata:{language:'es',deliveryVersion:1}}]}));
 });
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/phase6-test-harness');await page.getByRole('button',{name:'Intentar de nuevo',exact:true}).waitFor();await page.waitForTimeout(400);
 if(batches.length)throw Error('Diagnostic queue replayed before the account loaded');
 loadFailed=false;await page.getByRole('button',{name:'Intentar de nuevo',exact:true}).click();await page.getByRole('button',{name:'Editar datos',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Etapa educativa',exact:true}).waitFor();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('heading',{name:'Education stage',exact:true}).waitFor();await page.getByRole('button',{name:'Español',exact:true}).click();
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByText('No se pudo cerrar sesión. Inténtalo de nuevo.',{exact:true}).waitFor();if(logouts!==1)throw Error('Onboarding logout was not available');
 await page.getByRole('button',{name:'Editar datos',exact:true}).click();await page.getByLabel('Nombre del estudiante',{exact:true}).waitFor();
 if(await page.getByLabel('Nombre del estudiante',{exact:true}).inputValue()!=='Private Luis')throw Error('Changing language lost the draft');
 if(await page.getByRole('combobox',{name:/Etapa educativa/}).inputValue()!=='Community college')throw Error('Spanish stage label changed the canonical value');
 await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();await page.getByText('No se pudo guardar. Tus datos siguen aquí. Intenta de nuevo.',{exact:true}).waitFor();await page.waitForTimeout(650);
 const events=batches.flatMap(b=>b.events);if(!events.some(e=>e.name==='save_failed'))throw Error('Failed save paused diagnostic delivery');
 if(!events.some(e=>e.name==='setup_method_changed'&&e.metadata.language==='en'))throw Error('Language switch not recorded');
 if(!batches.some(b=>b.attemptId==='11111111-1111-4111-8111-111111111111'))throw Error('Loaded account did not replay previous diagnostics');
 saveFailed=false;await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();await page.locator('.app-shell').waitFor();await page.waitForTimeout(650);
 const opened=batches.flatMap(b=>b.events).filter(e=>e.name==='onboarding_opened').length;await page.reload();await page.locator('.app-shell').waitFor();await page.waitForTimeout(400);
 if(await page.locator('.welcome-conversation').count()||batches.flatMap(b=>b.events).filter(e=>e.name==='onboarding_opened').length!==opened)throw Error('Completed user returned to onboarding');
 if(/Private Ana|Private Luis|Private school/.test(JSON.stringify(batches)))throw Error('Profile text leaked into diagnostics');if(errors.length)throw Error('Browser exceptions: '+errors.join('; '));
 return {passed:true,accountLoadRecovery:true,bilingualForm:true,logoutRecovery:true,failedSaveTracked:true,returnToHome:true};
}
