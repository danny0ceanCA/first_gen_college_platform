async page=>{
 const origin='http://127.0.0.1:5176',errors=[],requests=[];let verified=false,revoked=false,quality=false;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/admin',async route=>{
  const body=route.request().postDataJSON();requests.push(body.action);
  if(body.action==='access')return route.fulfill({json:{admin:true,permissions:quality?['read:quality']:['read:activity'],actions:quality?['review-queue','review-history','review-evidence','voice-quality','conversation-quality']:['overview','progress-report','onboarding-metrics','onboarding-alerts'],authenticationRequired:verified?null:'staff_mfa_required'}});
  if(revoked)return route.fulfill({status:403,json:{error:'staff_access_revoked'}});
  if(!verified)throw Error('A data request bypassed the step-up screen');
  if(body.action==='overview')return route.fulfill({json:{totals:{users:5,new_users:2,voice_minutes:30,active_users:3},activity:[],users:[],series:[],window:{days:30},generatedAt:new Date().toISOString()}});
  if(body.action==='review-queue')return route.fulfill({json:{items:[{key:'a'.repeat(32),accountId:'11111111-1111-4111-8111-111111111111',name:'Synthetic account',source:'onboarding',kind:'profile_save',title:'Profile save request failed',evidence:'server',occurrences:1,firstAt:'2026-10-10T12:00:00Z',latestAt:'2026-10-10T12:00:00Z',status:'open',revision:'b'.repeat(64)}],total:1,page:1,pageSize:20,counts:{open:1,investigating:0,resolved:0,recovered:0},window:{end:'2026-10-10T18:00:00Z'},coverage:{available:true,guidanceEnabled:true,onboardingRetentionDays:90,dates:{}}}});
  if(body.action==='review-history')return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
  throw Error('Unexpected action '+body.action);
 });
 const source=await(await page.request.get(origin+'/src/AdminDashboard.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/privacy-staff-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import AdminDashboard from '/src/AdminDashboard.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/accessibility.css';import '/src/brand.css';
 import {browserPrivacy} from '/src/browserPrivacy.mjs';browserPrivacy.start('auth0|synthetic-staff',{fresh:true});const token=async()=>'synthetic-token';setAPITokenProvider(token);ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:{isAuthenticated:true,isLoading:false,user:{sub:'auth0|synthetic-staff'},getAccessTokenSilently:token,loginWithRedirect:async args=>{window.lastStepUp=args;},logout:async()=>{}}},React.createElement(AdminDashboard)));
 </script></body></html>`}));
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/privacy-staff-harness');
 await page.getByText('Verify your identity to open staff reports.').waitFor();
 if(requests.includes('overview'))throw Error('Staff data loaded before verification');
 await page.getByRole('button',{name:'Verify my identity',exact:true}).click();
 const params=await page.evaluate(()=>window.lastStepUp);
 if(params.authorizationParams.max_age!==0||params.authorizationParams.acr_values!=='http://schemas.openid.net/pape/policies/2007/06/multi-factor'||params.appState.returnTo!=='#admin')throw Error('Step-up request is incomplete');
 verified=true;await page.reload();await page.getByText('Registered users',{exact:true}).waitFor();
 const nav=page.getByRole('navigation',{name:'Admin navigation'});
 for(const label of ['Users','Engagement','Review queue','Activity','Voice quality','Institutions'])if(await nav.getByRole('button',{name:label,exact:true}).count())throw Error('Unpermitted navigation '+label);
 if(await page.getByText('Latest activity',{exact:true}).count())throw Error('Named activity rendered for an analyst');
 await page.screenshot({path:'output/playwright/privacy-phase3-staff-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
 await page.screenshot({path:'output/playwright/privacy-phase3-staff-mobile.png'});
 revoked=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('This account does not have admin access.').waitFor();
  if(await page.getByText('Registered users',{exact:true}).count())throw Error('Revocation retained private reporting data');
 revoked=false;quality=true;await page.reload();await page.getByRole('button',{name:'Review item',exact:true}).click();
 if(!await page.getByRole('button',{name:'Mark investigating',exact:true}).isDisabled())throw Error('Read-only reviewer can edit');
 if(!await page.getByRole('button',{name:'Open account journey',exact:true}).isDisabled())throw Error('Read-only reviewer can open user directory');
 if(errors.length)throw Error(errors.join('\n'));
 return {passed:true,checks:'MFA gate, redirect parameters, permission-filtered navigation, hidden named activity, desktop/mobile layout, revocation clears reports'};
}
