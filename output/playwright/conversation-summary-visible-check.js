async page=>{
 const origin='http://127.0.0.1:5192',errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 const student={id:'summary-student',name:'Sample Student',stage:'Community college',school:'',interest:'',gpa:'',color:'lilac'};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();let json={ok:true};
  if(path==='/api/family')json={account:{firstName:'Sample Parent',email:'',role:'parent',welcomeHeard:true},students:[student]};
  else if(path==='/api/conversation-history')json={items:[{id:'sample-conversation',studentId:student.id,mode:'planning',date:'2026-10-09T12:00:00Z',summary:'Saved discussion',sources:[]}]};
  else if(path==='/api/conversation-summary'){
   requests.push(body);json={summary:body.language==='es'?'Resumen visible de la conversación.':body.studentId?'Visible student conversation summary.':'Visible family conversation summary.',date:'2026-10-09T12:00:00Z',sources:[{title:'Federal Student Aid',url:'https://studentaid.gov/',checkedAt:'2026-10-09'}]};
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/App.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/summary-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import App from '/src/App.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/overview.css';import '/src/guidance.css';import '/src/accessibility.css';import '/src/brand.css';
 localStorage.clear();localStorage.setItem('origen.language','en');
 const subject='auth0|synthetic-summary',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/summary-harness');
 const card=page.locator('.student-conversation-card').first(),profile=card.locator('details.student-dropdown');
 await card.scrollIntoViewIfNeeded();await card.getByText('Visible student conversation summary.',{exact:true}).waitFor();
 if(await profile.getAttribute('open')!==null)throw Error('Profile should start collapsed');
 if(await card.locator('.conversation-history').evaluate(node=>!!node.closest('details')))throw Error('Summary is inside a collapsible section');
 await profile.locator('summary').first().click();await profile.locator('summary').first().click();
 if(!await card.getByText('Visible student conversation summary.',{exact:true}).isVisible())throw Error('Collapsing profile hid summary');
 if(await card.locator('.history-sources').getAttribute('open')!==null)throw Error('Sources should remain collapsed');
 await page.screenshot({path:'output/playwright/conversation-summary-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await card.scrollIntoViewIfNeeded();
 if(!await card.getByText('Visible student conversation summary.',{exact:true}).isVisible())throw Error('Mobile summary hidden');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile horizontal overflow');
 await page.screenshot({path:'output/playwright/conversation-summary-mobile.png',fullPage:true});
 await page.getByRole('button',{name:/^ES/}).click();await card.scrollIntoViewIfNeeded();await card.getByText('Resumen visible de la conversación.',{exact:true}).waitFor();
 if(!requests.some(body=>body.language==='es'&&body.studentId===student.id))throw Error('Spanish summary not requested');
 if(requests.some(body=>body.mode==='planning'))throw Error('Hidden planning page requested a summary');
 if(errors.length)throw Error(errors.join('; '));
 return {passed:true,desktop:true,mobile:true,collapsedProfile:true,spanish:true,hiddenPageSkipped:true};
}
