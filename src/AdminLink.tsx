import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useState} from 'react';
import {apiFetch} from './api';
export function AdminLink(){const {getAccessTokenSilently}=useAuth0();const [allowed,setAllowed]=useState(false);useEffect(()=>{let active=true;void getAccessTokenSilently().then(token=>apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'})})).then(r=>{if(active)setAllowed(r.ok);}).catch(()=>{});return()=>{active=false;};},[]);return allowed?<a href="#admin">Admin dashboard</a>:null;}
