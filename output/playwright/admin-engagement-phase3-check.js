async page=>{
 const origin='http://127.0.0.1:5192',requests=[],errors=[];let mode='normal',slowRole=false;
 page.on('pageerror',error=>errors.push(error.message));
 const counts={registered:12,saved:10,home_eligible:11,home:8,activated:8,mature_registrations:10,saved_within_7d:2,activated_within_7d:2,mature_activations:6,returned_within_7d:3};
 const daily=[
  {...counts,cohort_date:'2026-10-19',registered:2,saved:2,home_eligible:2,home:2,activated:2,mature_registrations:0,saved_within_7d:0,activated_within_7d:0,mature_activations:0,returned_within_7d:0},
  {...counts,cohort_date:'2026-10-06',registered:9,saved:7,home_eligible:8,home:5,activated:5,mature_registrations:9,saved_within_7d:1,activated_within_7d:1,mature_activations:5,returned_within_7d:2},
  {...counts,cohort_date:'2026-10-05',registered:1,saved:1,home_eligible:1,home:1,activated:1,mature_registrations:1,saved_within_7d:1,activated_within_7d:1,mature_activations:1,returned_within_7d:1}
 ];
 function report(body){
  const empty=body.role==='unknown',zero=Object.fromEntries(Object.keys(counts).map(k=>[k,0]));
  return {coverage:{available:mode!=='unavailable',measuredSince:'2026-10-01T00:00:00Z',homeSince:'2026-10-02T00:00:00Z',onboardingRetentionDays:90},window:{days:body.days,start:'2026-09-20T12:00:00Z',end:'2026-10-20T12:00:00Z'},generatedAt:'2026-10-20T12:00:00Z',scope:empty?{registered:0,known_admins:0,before_tracking:0}:{registered:14,known_admins:1,before_tracking:1},usage:empty?{active_accounts:0,calls:0,active_account_days:0,active_without_signin:0}:{active_accounts:14,calls:27,active_account_days:20,active_without_signin:4},cohort:{totals:empty?zero:counts,days:empty?[]:daily},metrics:empty?{setupWithin7d:{numerator:0,denominator:0,percent:null},activationWithin7d:{numerator:0,denominator:0,percent:null},returnWithin7d:{numerator:0,denominator:0,percent:null}}:{setupWithin7d:{numerator:2,denominator:10,percent:20},activationWithin7d:{numerator:2,denominator:10,percent:20},returnWithin7d:{numerator:3,denominator:6,percent:50}}};
 }
 await page.route('**/api/**',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  if(body.action==='overview'){if(mode==='denied')await new Promise(resolve=>setTimeout(resolve,500));return route.fulfill({contentType:'application/json',body:JSON.stringify({totals:{users:14},users:[],activity:[],series:[],generatedAt:'2026-10-20T12:00:00Z',window:{days:body.days}})});}
  if(body.action!=='engagement')throw Error('Unexpected action '+body.action);
  if(slowRole&&body.role==='parent'){slowRole=false;await new Promise(resolve=>setTimeout(resolve,650));}
  if(mode==='denied')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"admin_required"}'});
  if(mode==='error'){mode='normal';return route.fulfill({status:503,contentType:'application/json',body:'{"error":"engagement_unavailable"}'});}
  return route.fulfill({contentType:'application/json',body:JSON.stringify(report(body))});
 });
 const source=await(await page.request.get(origin+'/src/AdminDashboard.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/admin-engagement-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminDashboard from '/src/AdminDashboard.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/brand.css';
 const getToken=async()=>'synthetic-token';setAPITokenProvider(getToken);const auth={isAuthenticated:true,isLoading:false,user:{sub:'auth0|synthetic-admin'},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(AdminDashboard)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1050});await page.goto(origin+'/admin-engagement-harness');
 await page.getByRole('heading',{name:'Activity overview',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Engagement',exact:true}).click();
 const area=page.getByRole('region',{name:'Activation & returns'}),role=area.getByRole('combobox',{name:'Account-holder role'}),group=area.getByRole('combobox',{name:'Group by'}),table=area.getByRole('table');
 await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 if(requests.filter(r=>r.action==='engagement').at(-1).days!==30)throw Error('Initial period not 30 days');
 if(await area.locator('.admin-engagement-stats article').count()!==3)throw Error('Missing metric cards');
 const cards=area.locator('.admin-engagement-stats');
 if(await cards.getByText('2 / 10 eligible accounts',{exact:true}).count()!==2)throw Error('Eligible denominators missing');
 await cards.getByText('3 / 6 eligible accounts',{exact:true}).waitFor();await cards.getByText('2 activations waiting for seven days',{exact:true}).waitFor();
 const week=table.getByRole('row').filter({hasText:'Week of 2026-10-05'});
 if(await week.getByText('20%',{exact:true}).count()!==2)throw Error('Weekly rates should weight counts, not average percentages');
 const recent=table.getByRole('row').filter({hasText:'Week of 2026-10-19'});
 if(await recent.getByText('No eligible accounts',{exact:true}).count()!==3)throw Error('Recent cohorts should have no eligible window');
 await group.selectOption('day');await table.getByText('2026-10-06',{exact:true}).waitFor();
 if(await table.getByRole('row').count()!==4)throw Error('Day grouping incorrect');
 await group.selectOption('week');
 const stats=area.locator('.admin-engagement-usage');await stats.getByText('4',{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/admin-engagement-phase3-desktop.png',fullPage:true});
 await page.getByRole('combobox',{name:'Reporting period'}).selectOption('7');await area.getByText('New registration cohorts · last 7 days · distinct app accounts',{exact:true}).waitFor();await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 if(requests.filter(r=>r.action==='engagement').at(-1).days!==7)throw Error('Reporting period not applied');
 await page.getByRole('combobox',{name:'Reporting period'}).selectOption('90');await area.getByText('New registration cohorts · last 90 days · distinct app accounts',{exact:true}).waitFor();await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 slowRole=true;await role.selectOption('parent');await role.selectOption('unknown');await area.getByText('No tracked registrations in this period',{exact:true}).waitFor();await page.waitForTimeout(850);
 if(await cards.getByText('No eligible observation windows yet',{exact:true}).count()!==3)throw Error('Empty or stale role result is misleading');
 if(await area.getByText('12 tracked registrations',{exact:true}).count())throw Error('Stale parent response replaced latest filter');
 mode='error';await role.selectOption('student');await area.getByRole('button',{name:'Retry engagement report'}).click();await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 mode='unavailable';await role.selectOption('all');await area.getByRole('heading',{name:'Tracking is not available yet'}).waitFor();
 if(await area.locator('.admin-engagement-stats article').count())throw Error('Unavailable tracking still rendered rates');
 mode='normal';await page.getByRole('button',{name:'Refresh',exact:true}).click();await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Reporting period'}).selectOption('30');await area.getByText('New registration cohorts · last 30 days · distinct app accounts',{exact:true}).waitFor();await area.getByText('12 tracked registrations',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile page overflows horizontally');
 await page.screenshot({path:'output/playwright/admin-engagement-phase3-mobile.png',fullPage:true});
 const scroll=area.getByRole('region',{name:'Registration cohorts, scroll for more columns'});await scroll.scrollIntoViewIfNeeded();await scroll.focus();
 if(!await scroll.evaluate(el=>el.scrollWidth>el.clientWidth))throw Error('Mobile cohort columns need internal scrolling');
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);if(!await scroll.evaluate(el=>el.scrollLeft>0))throw Error('Keyboard table scrolling failed');
 await page.screenshot({path:'output/playwright/admin-engagement-phase3-mobile-cohorts.png'});
 await area.getByText('Definitions, sources & coverage',{exact:true}).click();await area.getByText('Registration cohort',{exact:true}).waitFor();
 const readsBeforeDenial=requests.filter(r=>r.action==='engagement').length;
 mode='denied';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'This account does not have admin access.'}).waitFor();await page.waitForTimeout(750);
 if(await area.count())throw Error('Engagement data remains after access denial');
 if(requests.filter(r=>r.action==='engagement').length!==readsBeforeDenial+1)throw Error('Stale overview response remounted engagement after access denial');
 if(errors.length)throw Error(errors.join('; '));
 return {passed:true,realNavigation:true,weightedCohorts:true,maturity:true,periods:true,filters:true,staleResponses:true,retry:true,coverage:true,mobile:true,keyboard:true,revocation:true};
}
