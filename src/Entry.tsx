import {useEffect,useState} from 'react';
import App from './App';
import Landing from './Landing';
export default function Entry(){
 const [inside,setInside]=useState(window.location.hash==='#app');
 useEffect(()=>{const update=()=>{setInside(window.location.hash==='#app');window.scrollTo(0,0);};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 return inside?<App/>:<Landing enter={()=>{window.location.hash='app';}}/>;
}
