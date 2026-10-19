// Real binder and signal store, synthetic account/notes; no microphone or model.
async page=>{
 await page.setViewportSize({width:1280,height:960});
 await page.route('**/src/StudentMemory.tsx',r=>r.fulfill({contentType:'text/javascript',body:'export default function(){return null}'}));
 for(const name of ['CoordinatorNotifications','CoordinatorConnection','BinderSharing'])await page.route(`**/src/${name}.tsx`,r=>r.fulfill({contentType:'text/javascript',body:'export default function(){return null}'}));
 await page.route('**/src/CoordinatorGuidance.tsx',r=>r.fulfill({contentType:'text/javascript',body:'export default function(){return null};export function useGuidanceRequest(){return async()=>({feedback:[]})}'}));
 await page.route('**/node_modules/.vite/deps/@auth0_auth0-react.js*',r=>r.fulfill({contentType:'text/javascript',body:`export function useAuth0(){return {user:{sub:'synthetic'},getAccessTokenSilently:async()=> 'a.'+btoa(JSON.stringify({sub:'synthetic'}))+'.c'}}`}));
 await page.route('**/src/api.ts',r=>r.fulfill({contentType:'text/javascript',body:`export async function apiFetch(path,options){if(path!='/api/topic-notes')throw Error('Unexpected API: '+path);const input=JSON.parse(options.body);return new Response(JSON.stringify({notes:window.__notes.filter(n=>n.studentId===input.studentId),generatedSummaryIds:[],pendingCount:0}),{status:200,headers:{'Content-Type':'application/json'}})}`}));
 await page.route('**/src/ConversationHistory.tsx',r=>r.fulfill({contentType:'text/javascript',body:`import React from '/node_modules/.vite/deps/react.js';const subscribe=cb=>{window.addEventListener('fake-history',cb);return()=>window.removeEventListener('fake-history',cb)};export function useConversationHistory(){const items=React.useSyncExternalStore(subscribe,()=>window.__history);return {cloud:true,items,loading:false,error:false,overview:async()=>({summary:''})}}`}));
 await page.route('**/binder-glow-preview',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import TopicNotebook from '/src/TopicNotebook.tsx';import {binderActivity} from '/src/binderActivity.ts';import {browserPrivacy} from '/src/browserPrivacy.mjs';import '/src/styles.css';import '/src/overview.css';import '/src/brand.css';
 window.__history=[];window.__notes=[];window.__binderActivity=binderActivity;
 const h=React.createElement,t=(en,es)=>window.__language==='es'?es:en;
 window.__language='en';
 window.__addNote=(topic,id)=>{window.__notes=[...window.__notes,{id,studentId:'student-a',topic,kind:'note',content:'My new '+topic+' note: questions and ideas to bring to my next college conversation.',language:'en',status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:'2026-10-19T20:00:00Z',sources:[],conversationAt:null}];window.__history=[{id:'summary-'+id,studentId:'student-a',date:'2026-10-19T20:00:00Z',mode:'planning',summary:'Synthetic summary'}];window.dispatchEvent(new Event('fake-history'));};
 window.__notes=[{id:'old-note',studentId:'student-a',topic:'options',kind:'note',content:'I want to compare local colleges and explore majors that interest me.',language:'en',status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:'2026-10-18T20:00:00Z',sources:[],conversationAt:null}];
 browserPrivacy.start('synthetic',{fresh:true});
 function Preview(){const [language,setLanguage]=React.useState('en');window.__setLanguage=value=>{window.__language=value;setLanguage(value)};return h('main',{style:{maxWidth:1120,margin:'24px auto',padding:'0 16px 40px'}},h('h1',{style:{fontSize:22}},'Binder conversation preview'),h(TopicNotebook,{initiallyOpen:true,studentId:'student-a',name:'Alex',role:'parent',language,t,navigate:()=>{},renderSummary:()=>h('section',null,h('h3',null,'Your conversation summary'),h('p',null,'This page stays open while other topics glow.'))}));}
 ReactDOM.createRoot(document.getElementById('root')).render(h(Preview));
 </script></body></html>`}));
 await page.goto('http://127.0.0.1:5174/binder-glow-preview');
 await page.getByRole('tab',{name:/College options/}).waitFor();
 await page.waitForFunction(()=>!document.body.textContent.includes('Loading your notebook'));
 return {ready:true};
}
