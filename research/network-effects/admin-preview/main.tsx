import {createRoot} from 'react-dom/client';
import AdminDashboard from '../../../src/AdminDashboard';
import {browserPrivacy} from '../../../src/browserPrivacy.mjs';
import {configurePreviewAuth} from './auth';
import '../../../src/designSystem.css';
import '../../../src/brand.css';
import './preview.css';

async function start(){
 const response=await fetch('/__network-preview/session',{cache:'no-store'});
 if(!response.ok)throw new Error('The isolated preview session could not start.');
 const session=await response.json();configurePreviewAuth(session);
 browserPrivacy.start(session.subject,{fresh:true});
 createRoot(document.getElementById('root')!).render(<><div className="network-preview-banner">Isolated admin preview · fictional evidence · no live voice or production connections</div><AdminDashboard initialView="network-effects"/></>);
}
void start().catch(error=>{const root=document.getElementById('root');if(root)root.textContent=error instanceof Error?error.message:'Preview unavailable.';});
