// Local synthetic review only. No .env, Auth0, production DB, AI or email calls.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer as createViteServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fixture} from '../server/family-fixture.mjs';
import {createApp} from '../server/index.mjs';
import {GUARDIAN_NOTICE,GUARDIAN_NOTICE_VERSION} from '../server/guardian-email.mjs';
const {pool}=await fixture(),mailbox=[];
const app=createApp({ALLOWED_ORIGINS:'http://127.0.0.1:5183'},async token=>{if(!['synthetic-teen','synthetic-adult','synthetic-other'].includes(token))throw Error();return {sub:token};},pool,()=>{},{permission:{mailer:{async send(mail){mailbox.push(mail);return 'mock';}}}});
const server=createServer((req,res)=>{
 if(req.url==='/__review/mailbox'&&req.method==='GET'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(mailbox.map(m=>({...m,notice:GUARDIAN_NOTICE,noticeVersion:GUARDIAN_NOTICE_VERSION}))));}
 return app(req,res);
});
await new Promise(r=>server.listen(5184,'127.0.0.1',r));
await mkdir('tmp/guardian-review',{recursive:true});
await writeFile('tmp/guardian-review/entry.tsx',`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Auth0Context} from '@auth0/auth0-react';import EligibilityGate from '/src/EligibilityGate';import GuardianPermission from '/src/GuardianPermission';import {browserPrivacy} from '/src/browserPrivacy.mjs';
function Review(){const [subject,setSubject]=useState('synthetic-teen'),[messages,setMessages]=useState([]);const token=/^#guardian\\/([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1];if(token)return <GuardianPermission token={token}/>;return <><aside style={{padding:16,background:'#fff1c9'}}>SYNTHETIC LOCAL REVIEW — no real email, Auth0, OpenAI or production database.<label>Review account <select aria-label="Review account" value={subject} onChange={e=>{browserPrivacy.stop('account_changed');setSubject(e.target.value);}}>{['synthetic-teen','synthetic-adult','synthetic-other'].map(s=><option key={s}>{s}</option>)}</select></label><button onClick={async()=>setMessages(await(await fetch('/__review/mailbox')).json())}>View mock mailbox</button>{messages.map((m:any)=><p key={m.requestId}>Synthetic recipient: {m.to} · Reference: {m.requestId} · <a target="_blank" rel="noreferrer" href={'/guardian-review#guardian/'+m.approvalToken}>Review approval</a> · <a target="_blank" rel="noreferrer" href={'/guardian-review#guardian/'+m.withdrawalToken}>Withdraw</a></p>)}</aside><Auth0Context.Provider value={{isLoading:false,isAuthenticated:true,user:{sub:subject},getAccessTokenSilently:async()=>subject,logout:async()=>setSubject('synthetic-other')} as any}><EligibilityGate key={subject}><main className="eligibility-panel"><h1>Protected account is available</h1><p>This local review does not collect profiles or activate AI or a microphone.</p></main></EligibilityGate></Auth0Context.Provider></>;}createRoot(document.getElementById('root')!).render(<Review/>);`);
const vite=await createViteServer({configFile:false,envFile:false,plugins:[react(),{name:'synthetic-permission-review',configureServer(dev){dev.middlewares.use('/guardian-review',async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/guardian-review','<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/tmp/guardian-review/entry.tsx"></script></body></html>'));});}}],define:{'import.meta.env.VITE_API_URL':JSON.stringify('')},server:{host:'127.0.0.1',port:5183,strictPort:true,proxy:{'/api':'http://127.0.0.1:5184','/__review/mailbox':'http://127.0.0.1:5184'}}});

await vite.listen();console.log('Synthetic permission review: http://127.0.0.1:5183/guardian-review (Ctrl+C to stop; all test data is in memory).');
const stop=async()=>{await vite.close();server.close();await pool.end();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
