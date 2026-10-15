async page=>{
 const origin='http://127.0.0.1:5183',errors=[],results=[];
 await page.context().unrouteAll({behavior:'wait'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.context().route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'synthetic_no_backend'}});
  return route.continue();
 });
 const source=await(await page.request.get(origin+'/src/Welcome.tsx')).text();
 const authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.context().route('**/privacy-onboarding-harness*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import Welcome from '/src/Welcome.tsx';import {FamilyProvider} from '/src/FamilyStore.tsx';import {ConversationHistoryProvider} from '/src/ConversationHistory.tsx';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';import {browserPrivacy} from '/src/browserPrivacy.mjs';import '/src/styles.css';import '/src/accessibility.css';import '/src/brand.css';
 localStorage.clear();sessionStorage.clear();browserPrivacy.start('preview',{fresh:true});window.launches=0;window.microphones=0;
 navigator.mediaDevices.getUserMedia=async()=>{window.microphones++;throw new DOMException('Synthetic denied microphone','NotAllowedError');};
 const params=new URLSearchParams(location.search),language=params.has('es')?'es':'en';
 const tracker={id:'synthetic-onboarding',event:()=>{},fields:()=>{},open:()=>{},flush:async()=>{},pause:()=>{},resume:()=>{}};
 const shared={active:false,launch:()=>window.launches++,open:()=>{},syncOnboarding:()=>{}};
 let content=React.createElement(Welcome,{language,setLanguage:()=>{},cloud:false,initialName:'',onComplete:()=>{},complete:async()=>false,tracker});
 if(!params.has('local'))content=React.createElement(SharedVoiceContext.Provider,{value:shared},content);
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:{isAuthenticated:false,isLoading:false,user:undefined,getAccessTokenSilently:async()=>undefined,logout:async()=>{}}},React.createElement(FamilyProvider,{previewStudents:[]},React.createElement(ConversationHistoryProvider,null,content))));
 </script></body></html>`}));
 for(const local of [false,true])for(const es of [false,true])for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:width===1280?900:844});
  await page.goto(origin+'/privacy-onboarding-harness?'+(local?'local&':'')+(es?'es':''));
  const notice=page.locator('.voice-privacy-disclosure');await notice.waitFor();
  if(!await notice.isVisible())throw Error('Disclosure hidden');
  const paragraphs=notice.locator('p');for(let i=0;i<2;i++)if(!await paragraphs.nth(i).isVisible())throw Error('Disclosure paragraph hidden');
  const text=await notice.textContent();if(!text.includes('OpenAI')||!text.includes(es?'sin aprobación adicional':'without separate approval'))throw Error('Missing privacy facts');
  const start=page.getByRole('button',{name:es?'Hablar con Origen':'Talk with Origen',exact:true});
  if(await start.getAttribute('aria-describedby')!==await notice.getAttribute('id'))throw Error('Missing accessible disclosure association');
  const before=await page.evaluate(()=>({launches:window.launches,microphones:window.microphones,overflow:document.documentElement.scrollWidth>innerWidth}));
  if(before.launches||before.microphones||before.overflow)throw Error('Unexpected capture, launch or horizontal overflow');
  if(width===390)await page.screenshot({path:'output/playwright/privacy-followup-'+(local?'local':'shared')+'-'+(es?'es':'en')+'.png',fullPage:true});
  await start.click();
  if(local)await page.getByRole('button',{name:es?'Hablar con Origen':'Talk with Origen',exact:true}).waitFor();
  const after=await page.evaluate(()=>({launches:window.launches,microphones:window.microphones}));
  if(local?after.microphones!==1||after.launches!==0:after.launches!==1||after.microphones!==0)throw Error('Launch callback did not behave as expected');
  results.push({path:local?'local':'shared',language:es?'es':'en',width,disclosureBeforeStart:true});
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({cases:results.length,results,errors,scope:'Synthetic providers; microphone denied by mock; no live API or audio'},null,2));
}
