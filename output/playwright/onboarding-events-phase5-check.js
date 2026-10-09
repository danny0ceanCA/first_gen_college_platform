async page => {
 const origin='http://127.0.0.1:5178',batches=[],errors=[];let offline=true,alertMode='normal',alertCalls=0;
 page.on('pageerror',e=>errors.push(e.message));
 const alertReport={available:true,window:{start:'2026-10-08T20:00:00Z',end:'2026-10-09T20:00:00Z'},checks:[{key:'connection',label:'Voice connection problems',eligible:10,affected:3,ratePercent:30,insufficient:false,review:true},{key:'save',label:'Profile saving problems',eligible:2,affected:1,ratePercent:50,insufficient:true,review:false}],reviewCount:1,observedVisits:10,recoveredDeliveryVisits:2,thresholds:{minimumVisits:10,minimumAffected:3,ratePercent:25}};
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();let status=200,json={ok:true};
  if(new URL(route.request().url()).pathname==='/api/onboarding-events'){batches.push(body);if(offline)status=503;}
  else if(body.action==='onboarding-alerts'){alertCalls++;if(alertMode==='error'){status=503;json={error:'unavailable'};}else if(alertMode==='deny'){status=403;json={error:'admin_required'};}else json=alertMode==='unavailable'?{available:false}:alertReport;}
  else throw Error('Unexpected mocked action '+body.action);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/AdminUsers.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 const imports=`import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';`;
 await page.route('**/phase5-delivery-harness',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="test-root"></div><script type="module">${imports}
 import {onboardingEvents} from '/src/onboardingEvents.mjs';import {useOnboardingDelivery} from '/src/useOnboardingDelivery.ts';import {onboardingTransport} from '/src/api.ts';
 const subject=sessionStorage.getItem('phase5.subject')||'auth0|synthetic-phase5-one',tokenSubject=sessionStorage.getItem('phase5.tokenSubject')||subject;
 const token='test.'+btoa(JSON.stringify({sub:tokenSubject}))+'.test';
 function Harness(){const [tracker]=React.useState(()=>onboardingEvents(onboardingTransport(subject,async()=>token),{scope:subject,storage:localStorage}));useOnboardingDelivery(tracker);return React.createElement('main',null,React.createElement('h1',null,'Delivery harness'),React.createElement('button',{onClick:()=>{tracker.open({language:'es',token:'private-token',transcript:'private-words'});tracker.fields({school:true,name:'Private Name'});void tracker.flush();}},'Record synthetic visit'),React.createElement('button',{onClick:()=>window.dispatchEvent(new Event('origen-account-closed'))},'Close synthetic account'));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Harness));
 </script></body></html>`}));
 await page.goto(origin+'/phase5-delivery-harness');await page.getByRole('button',{name:'Record synthetic visit'}).click();await page.waitForTimeout(150);
 const keys=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('.onboarding-events.')));
 if((await keys()).length!==1)throw Error('Offline queue not persisted');const first=batches[0];
 if(/private-token|private-words|Private Name/.test(await page.evaluate(()=>JSON.stringify(localStorage))))throw Error('Private content persisted');
 offline=false;await page.reload();await page.getByRole('heading',{name:'Delivery harness'}).waitFor();await page.waitForTimeout(250);
 if(!batches.some((b,i)=>i>0&&b.attemptId===first.attemptId&&b.events[0].sequence===first.events[0].sequence))throw Error('Refresh did not replay original keys');
 if((await keys()).length)throw Error('Acknowledged queue retained');
 offline=true;await page.getByRole('button',{name:'Record synthetic visit'}).click();await page.waitForTimeout(100);const count=batches.length;
 await page.evaluate(()=>sessionStorage.setItem('phase5.subject','auth0|synthetic-phase5-two'));await page.reload();await page.getByRole('heading',{name:'Delivery harness'}).waitFor();await page.waitForTimeout(250);
 if(batches.length!==count||(await keys()).length!==1)throw Error('Different account replayed another account queue');
 await page.evaluate(()=>{sessionStorage.setItem('phase5.subject','auth0|synthetic-phase5-one');sessionStorage.setItem('phase5.tokenSubject','auth0|synthetic-phase5-two');});await page.reload();await page.getByRole('heading',{name:'Delivery harness'}).waitFor();await page.waitForTimeout(250);
 if(batches.length!==count||(await keys()).length)throw Error('Subject mismatch sent or retained queued events');
 await page.evaluate(()=>sessionStorage.removeItem('phase5.tokenSubject'));await page.reload();await page.getByRole('button',{name:'Record synthetic visit'}).click();await page.waitForTimeout(100);await page.getByRole('button',{name:'Close synthetic account'}).click();await page.getByRole('button',{name:'Record synthetic visit'}).click();
 if((await keys()).length)throw Error('Closed account resurrected the queue');
 await page.route('**/phase5-alert-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">${imports}
 import {Auth0Context} from '${authModule}';import Alerts from '/src/AdminOnboardingAlerts.tsx';import '/src/styles.css';import '/src/accessibility.css';import '/src/admin.css';import '/src/brand.css';
 function Harness(){const [revision,setRevision]=React.useState(0),[denied,setDenied]=React.useState(false);return denied?React.createElement('p',null,'Access denied'):React.createElement('div',{className:'admin-workspace'},React.createElement('main',{className:'admin-dashboard'},React.createElement('section',{className:'admin-panel admin-onboarding-insights'},React.createElement('button',{onClick:()=>setRevision(r=>r+1)},'Refresh test'),React.createElement(Alerts,{revision,onDenied:()=>setDenied(true)}))));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:{getAccessTokenSilently:async()=>'synthetic-token'}},React.createElement(Harness)));
 </script></body></html>`}));
 await page.setViewportSize({width:1200,height:900});await page.goto(origin+'/phase5-alert-harness');await page.getByText('3 affected / 10 eligible visits · 30%',{exact:true}).waitFor();await page.getByText('Review',{exact:true}).waitFor();await page.getByText('Small sample',{exact:true}).waitFor();await page.getByText('Review thresholds and limitations').click();await page.getByText('no email or external notification is sent.',{exact:false}).waitFor();
 await page.screenshot({path:'output/playwright/onboarding-phase5-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:812});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error('Mobile overflow');await page.screenshot({path:'output/playwright/onboarding-phase5-mobile.png',fullPage:true});
 alertMode='error';await page.getByRole('button',{name:'Refresh test'}).click();await page.getByRole('button',{name:'Retry review flags'}).waitFor();alertMode='normal';await page.getByRole('button',{name:'Retry review flags'}).click();await page.getByText('Review',{exact:true}).waitFor();
 alertMode='unavailable';await page.getByRole('button',{name:'Refresh test'}).click();await page.getByText('Review flags require deployed onboarding capture.',{exact:true}).waitFor();if(await page.locator('.admin-onboarding-review-list').count())throw Error('Unavailable capture shown as rates');
 alertMode='deny';await page.getByRole('button',{name:'Refresh test'}).click();await page.getByText('Access denied',{exact:true}).waitFor();if(await page.getByRole('heading',{name:'Onboarding review flags'}).count())throw Error('Protected flags remain after denial');
 if(errors.length)throw Error('Browser exceptions: '+errors.join('; '));console.log('Passed: refresh replay, original event keys, sanitized browser storage, account isolation, token-subject mismatch, account closure, review/small sample flags, error retry, unavailable capture, permission revocation, desktop/mobile layouts. Alert requests: '+alertCalls);
}
