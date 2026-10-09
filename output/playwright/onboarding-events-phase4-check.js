async page => {
 const origin='http://127.0.0.1:5178',requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='failure',deny=false;
 const counts={attempts:5,saved:3,home:2,issues:2,mature:4,savedWithin24h:2};
 const report={coverage:{available:true,measuredSince:'2026-10-03T12:00:00Z',retentionDays:90},generatedAt:'2026-10-09T20:00:00Z',totals:{...counts,users:3,savedUsers:2,returningUsers:1,returningSavedUsers:1,voiceVisits:3,connectedVisits:2,phase3VoiceVisits:2,firstAudioVisits:1,nativeAcknowledged:1,saveRecoveryVisits:1,setupChangeVisits:2},issues:{microphone_denied:1,save_failed:1,playback_blocked:1},timings:{medianSaveMs:120000,saveSamples:3,medianFirstAudioMs:1200,audioSamples:1},segments:[{...counts,attempts:4,issues:1,language:'es',method:'voice'},{...counts,attempts:1,saved:0,issues:1,language:'unknown',method:'unknown'}],series:[{...counts,date:'2026-10-02',tracked:false,attempts:0,saved:0},{...counts,date:'2026-10-07',tracked:true,attempts:4,saved:2,issues:1},{...counts,date:'2026-10-09',tracked:true,attempts:1,saved:1,issues:1,mature:0,savedWithin24h:0}]};
 const empty={...report,totals:Object.fromEntries(Object.keys(report.totals).map(k=>[k,0])),issues:{},timings:{medianSaveMs:null,saveSamples:0,medianFirstAudioMs:null,audioSamples:0},segments:[],series:[]};
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  let json,status=200;
  if(deny){json={error:'admin_required'};status=403;}
  else if(body.action==='onboarding-metrics'){
   if(mode==='failure'){status=503;json={error:'onboarding_metrics_unavailable'};mode='normal';}
   else json=mode==='unavailable'?{...empty,coverage:{available:false,measuredSince:null,retentionDays:90}}:mode==='empty'?empty:report;
  }else if(body.action==='onboarding-alerts')json={available:false};
  else if(body.action==='users')json={users:[],total:0,page:1,pageSize:25,funnel:{registered:'3',started:'3',completed:'2',first_conversation:'1',untracked:'0',measured_since:'2026-10-01'}};
  else throw new Error('Unexpected mocked action '+body.action);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 const source=await(await page.request.get(origin+'/src/AdminUsers.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/phase4-test-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminUsers from '/src/AdminUsers.tsx';import '/src/styles.css';import '/src/accessibility.css';import '/src/admin.css';import '/src/brand.css';
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'auth0|synthetic-phase4'},getAccessTokenSilently:async()=>'synthetic-test-token'};
 function Harness(){const [denied,setDenied]=React.useState(false),[days,setDays]=React.useState(30),[revision,setRevision]=React.useState(0);return denied?React.createElement('p',null,'Access denied'):React.createElement('div',{className:'admin-workspace'},React.createElement('main',{className:'admin-dashboard'},React.createElement('label',null,'Period',React.createElement('select',{'aria-label':'Test period',value:days,onChange:e=>setDays(Number(e.target.value))},...[7,30,90].map(d=>React.createElement('option',{key:d,value:d},d+' days')))),React.createElement('button',{onClick:()=>setRevision(r=>r+1)},'Refresh test'),React.createElement(AdminUsers,{days,revision,onDenied:()=>setDenied(true)})));}
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(Harness)));
 </script></body></html>`}));
 await page.setViewportSize({width:1200,height:1000});await page.goto(origin+'/phase4-test-harness');
 await page.getByRole('button',{name:'Retry onboarding insights'}).click();
 const insights=page.getByRole('region',{name:'Onboarding insights'});
 await insights.getByText('66.7%',{exact:true}).waitFor();await insights.getByText('50%',{exact:true}).waitFor();
 await insights.getByText('1.2 sec · 1 visits',{exact:true}).waitFor();
 await insights.getByText('Spanish',{exact:true}).waitFor();await insights.getByText('Not recorded',{exact:true}).first().waitFor();
 await insights.getByRole('button',{name:'2026-10-02: capture unavailable'}).click();
 await insights.getByText('2026-10-02 UTC: detailed capture was unavailable. No visit count can be established.',{exact:true}).waitFor();
 await insights.getByRole('button',{name:'2026-10-09: 1 visits, 1 saved'}).click();
 await insights.getByText('2026-10-09 UTC: 1 visits · 1 confirmed saves · 1 with friction · — saved within 24 hours (0 eligible).',{exact:true}).waitFor();
 await page.getByText('How these measures work',{exact:true}).click();
 await insights.getByText('Capture began',{exact:false}).waitFor();
 await page.screenshot({path:'output/playwright/onboarding-phase4-desktop.png',fullPage:true});
 const count=requests.filter(r=>r.action==='onboarding-metrics').length;
 await page.getByRole('searchbox',{name:'Search name or user ID'}).fill('unrelated');
 await page.waitForTimeout(400);
 if(requests.filter(r=>r.action==='onboarding-metrics').length!==count)throw new Error('Directory search changed the cohort request');
 await page.setViewportSize({width:375,height:812});await insights.scrollIntoViewIfNeeded();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw new Error('Mobile document overflow');
 await page.screenshot({path:'output/playwright/onboarding-phase4-mobile.png',fullPage:true});
 mode='empty';await page.getByRole('combobox',{name:'Test period'}).selectOption('7');
 await insights.getByText('No retained visits began in this reporting period.',{exact:true}).waitFor();
 if(!requests.some(r=>r.action==='onboarding-metrics'&&r.days===7))throw new Error('Reporting period not sent');
 await insights.getByText('— · 0 visits',{exact:true}).waitFor();
 mode='unavailable';await page.getByRole('button',{name:'Refresh test'}).click();
 await insights.getByText('Detailed onboarding capture is not available yet.',{exact:false}).waitFor();
 if(await insights.locator('.admin-stats').count())throw new Error('Unavailable capture shown as zero stats');
 deny=true;await page.getByRole('button',{name:'Refresh test'}).click();await page.getByText('Access denied',{exact:true}).waitFor();
 if(await page.getByRole('region',{name:'Onboarding insights'}).count())throw new Error('Protected insights remained after denial');
 if(errors.length)throw new Error('Browser exception '+errors.join('; '));
 console.log('Passed: admin integration, retry, unique-user and mature-visit rates, unknown choices/capture, observed latency samples, UTC daily inspection, directory isolation, empty and unavailable states, period/refresh, mobile overflow and access revocation.');
}

