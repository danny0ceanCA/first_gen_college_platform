import LandingStory from './LandingStory';
import LandingVideo,{LandingVideoPlaceholder} from './LandingVideo';
import LandingDetails,{publicContactEmail} from './LandingDetails';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {animate} from 'animejs';
import {ArrowRight,ArrowUpRight,X} from 'lucide-react';
import './Landing.css';
const villageResidents=[
 {route:0,kind:'lady',x:170,y:389},{route:8,kind:'person',x:270,y:389},
 {route:1,kind:'person',x:438,y:389},{route:5,kind:'lady',x:510,y:389},
 {route:4,kind:'child',x:72,y:398},{route:6,kind:'student',x:340,y:538},
 {route:7,kind:'lady',x:354,y:447},{route:9,kind:'farmer',x:264,y:468},
 {route:10,kind:'farmer',x:466,y:502}
];
export default function Landing(){
 const {loginWithRedirect,isLoading,isAuthenticated,error}=useAuth0();
 const [copyStatus,setCopyStatus]=useState('');
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopyStatus(t('Copied. Ready to share.','Copiado. Listo para compartir.'));}catch{setCopyStatus(t('Copy was unavailable. Select the description or link below to copy it.','No se pudo copiar. Selecciona la descripción o el enlace para copiarlo.'));}};
 const [signinError,setSigninError]=useState(false);
 const signIn=(register=false)=>{if(isAuthenticated){window.location.hash='app';return;}setLogin(false);setSigninError(false);void loginWithRedirect({appState:{returnTo:'#app'},authorizationParams:{ui_locales:es?'es':'en',...(register?{screen_hint:'signup'}:{})}}).catch(()=>{setSigninError(true);setLogin(true);});};
 const [es,setEs]=useState(()=>localStorage.getItem('origen.language')==='es'),[login,setLogin]=useState(false),[replay,setReplay]=useState(0),[paused,setPaused]=useState(false);
 const motion=useRef<ReturnType<typeof animate>[]>([]),pauseRef=useRef(false),heroVisible=useRef(true);
 const line=useRef<SVGSVGElement>(null),ambient=useRef<SVGSVGElement>(null),sky=useRef<SVGSVGElement>(null),dialog=useRef<HTMLDialogElement>(null);
 const sceneId=useId().replace(/:/g,'');
 const t=(en:string,sp:string)=>es?sp:en;
 const shareDescription=t('Origen is an AI voice assistant that helps students and families make sense of college in English and Spanish. Ask questions, revisit explanations, and prepare for conversations with a counselor or coordinator. Explore it at https://origenedu.ai','Origen es un asistente de voz con inteligencia artificial que ayuda a estudiantes y familias a entender el camino a la universidad en español e inglés. Haz preguntas, repasa explicaciones y prepárate para conversar con un consejero o coordinador. Conócelo en https://origenedu.ai');
 useEffect(()=>{document.documentElement.lang=es?'es':'en';localStorage.setItem('origen.language',es?'es':'en');},[es]);
 useLayoutEffect(()=>{
  if(!line.current||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const scene=line.current;
  const animations:ReturnType<typeof animate>[]=[];
  // A soft mask reveals the complete illustration from sky to foreground.
  const gradient=scene.querySelector<SVGLinearGradientElement>('.scene-reveal-gradient')!;
  const reveal={edge:0};
  gradient.setAttribute('y1','-140');gradient.setAttribute('y2','0');
  animations.push(animate(reveal,{edge:[0,710],duration:1500,ease:'outCubic',onUpdate:()=>{
   gradient.setAttribute('y1',String(reveal.edge-140));gradient.setAttribute('y2',String(reveal.edge));
  }}));
  const sunArcs=scene.querySelector<SVGPathElement>('.sun-orbit')!;
  const orbit={angle:0};
  animations.push(animate(orbit,{angle:[0,360],duration:90000,loop:true,ease:'linear',onUpdate:()=>{
   sunArcs.setAttribute('transform',`rotate(${orbit.angle} 370 105)`);
  }}));
  // Clouds are already complete: they drift and breathe light, never draw or erase.
  const clouds=[...scene.querySelectorAll<SVGPathElement>('.sky-drift'),...ambient.current!.querySelectorAll<SVGPathElement>('path'),...sky.current!.querySelectorAll<SVGPathElement>('.upper-cloud')];
  clouds.forEach((cloud,index)=>{
   const phase={value:0};
   animations.push(animate(phase,{value:[0,Math.PI*2],duration:12000+index*1700,loop:true,ease:'linear',onUpdate:()=>{
    const wave=phase.value+index*1.7;
    cloud.setAttribute('transform',`translate(${Math.sin(wave)*46} ${Math.cos(wave)*7})`);
    cloud.style.opacity=String(0.65+0.35*(Math.sin(wave)+1)/2);
   }}));
  });
  sky.current!.querySelectorAll<SVGGElement>('.line-star').forEach((star,index)=>{
   const shimmer={phase:index*1.39};
   animations.push(animate(shimmer,{phase:[index*1.39,index*1.39+Math.PI*2],duration:4200+index%4*1100,loop:true,ease:'linear',onUpdate:()=>{
    const brightness=(Math.sin(shimmer.phase)+1)/2;
    star.style.opacity=String(0.22+0.78*brightness**2);
    star.style.filter=`drop-shadow(0 0 ${1+brightness*5}px #ffe2ad)`;
   }}));
  });
  // Neighbors meet in pairs, chat with room between their outlines, then head home.
  const residents=Array.from(scene.querySelectorAll<SVGGElement>('.village-resident')).map((visitor,order)=>{
   const index=Number(visitor.dataset.route);
   const arrival=scene.querySelector<SVGPathElement>(`.life-route-${index}`)!;
   const departure=scene.querySelector<SVGPathElement>(`.life-exit-${index}`)!;
   return {visitor,index,order,arrival,departure,arrivalLength:arrival.getTotalLength(),departureLength:departure.getTotalLength(),
    legs:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),
    arms:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-arm'))};
  });
  const village={time:0};
  const updateResidents=()=>{
   residents.forEach(({visitor,index,order,arrival,departure,arrivalLength,departureLength,legs,arms})=>{
    const gathering=index===0||index===8?0:index===1||index===5?1:null;
    const phase=(village.time+(gathering===null?0.42+order*0.11:gathering*0.32))%1;
    const chatting=gathering!==null&&phase>=0.22&&phase<0.44;
    const travelled=gathering!==null
     ?phase<0.22?arrivalLength*phase/0.22:phase<0.44?arrivalLength:arrivalLength+departureLength*Math.min(1,(phase-0.44)/0.28)
     :(arrivalLength+departureLength)*Math.min(1,phase/0.72);
    const leaving=travelled>=arrivalLength;
    const route=leaving?departure:arrival,length=leaving?departureLength:arrivalLength;
    const distance=leaving?travelled-arrivalLength:travelled,point=route.getPointAtLength(distance);
    const next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
    const resting=phase>=0.72;
    const facing=chatting?(index===0||index===1?1:-1):next.x<previous.x?-1:1,stride=chatting||resting?0:Math.sin(travelled*0.46);
    const scale=index===4?0.63:gathering!==null?0.78:index>=6?0.84:0.78;
    // The return route ends where the next walk starts: no fade or teleport.
    visitor.dataset.activity=chatting?'chatting':resting?'resting':'walking';
    visitor.style.opacity='0.9';
    visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
    legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1);leg.setAttribute('d',`M0 -10 L${swing*3} -5 L${swing*5} 0`);});
    arms.forEach((arm,i)=>{const swing=chatting?Math.sin(phase*Math.PI*36+i)*0.55+0.7:stride*(i?1:-1);arm.setAttribute('d',`M0 -18 L${swing*3} -14 L${swing*5} -12`);});
   });
  };
  updateResidents();
  animations.push(animate(village,{time:[0,1],duration:21000,delay:1500,loop:true,ease:'linear',onUpdate:updateResidents}));
  // Animals wander continuously on independent clocks.
  scene.querySelectorAll<SVGGElement>('.village-animal').forEach(visitor=>{
   const index=Number(visitor.dataset.route),burro=visitor.dataset.kind==='burro',bull=visitor.dataset.kind==='bull';
   const outward=scene.querySelector<SVGPathElement>(`.life-route-${index}`)!,homeward=scene.querySelector<SVGPathElement>(`.life-exit-${index}`)!;
   const outwardLength=outward.getTotalLength(),homewardLength=homeward.getTotalLength();
   const legs=Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),wander={time:0};
   const head=visitor.querySelector<SVGGElement>('.grazing-head'),tail=visitor.querySelector<SVGPathElement>('.animal-tail');
   animations.push(animate(wander,{time:[0,1],duration:bull?28000+index*300:burro?22000:16000,delay:1500,loop:true,ease:'linear',onUpdate:()=>{
    const back=wander.time>=0.5,progress=back?(wander.time-0.5)*2:wander.time*2;
    const route=back?homeward:outward,length=back?homewardLength:outwardLength,distance=length*progress;
    const point=route.getPointAtLength(distance),next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
    const facing=next.x<previous.x?-1:1,stride=Math.sin((distance+(back?outwardLength:0))*0.44),scale=bull?0.94:burro?0.78:0.72;
    visitor.dataset.activity='walking';visitor.style.opacity='0.9';
    visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
    legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1),hip=bull?(i<2?-11:10):burro?(i<2?-9:10):(i<2?-6:7),top=bull?-12:burro?-11:-7;leg.setAttribute('d',`M${hip} ${top} L${hip+swing*2.5} -5 L${hip+swing*4} 0`);});
    head?.setAttribute('transform',`rotate(${10+Math.sin(wander.time*Math.PI*16)*14} 12 -20)`);
    tail?.setAttribute('transform',`rotate(${Math.sin(wander.time*Math.PI*24)*12} -17 -24)`);
   }}));
  });
  // Farmers tend the terraces while walkers pass, each with a gentle hoeing rhythm.
  scene.querySelectorAll<SVGGElement>('.field-worker').forEach((worker,index)=>{
   const torso=worker.querySelector<SVGGElement>('.farmer-upper')!,work={phase:index*Math.PI};
   animations.push(animate(work,{phase:[index*Math.PI,index*Math.PI+Math.PI*2],duration:4800+index*900,loop:true,ease:'linear',onUpdate:()=>{
    torso.setAttribute('transform',`rotate(${4+Math.sin(work.phase)*12} 0 -10)`);
   }}));
  });
  motion.current=animations;
  const syncVisibility=()=>animations.forEach(a=>{if(pauseRef.current||!heroVisible.current||document.hidden)a.pause();else if(!a.completed)a.play();});
  const observer=new IntersectionObserver(([entry])=>{heroVisible.current=entry.isIntersecting;syncVisibility();},{rootMargin:'80px'});
  observer.observe(scene.closest('.landing-hero')!);document.addEventListener('visibilitychange',syncVisibility);syncVisibility();
  return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',syncVisibility);animations.forEach(animation=>animation.revert());gradient.setAttribute('y1','570');gradient.setAttribute('y2','710');motion.current=[];};
 },[replay]);
 useEffect(()=>{
  pauseRef.current=paused;
  motion.current.forEach(animation=>{if(paused||!heroVisible.current||document.hidden)animation.pause();else if(!animation.completed)animation.play();});
 },[paused]);
 useEffect(()=>{if(login)dialog.current?.showModal();else dialog.current?.close();},[login]);
 return <div className="landing">
  <header className="landing-nav"><a className="landing-logo" href="#" aria-label="Origen"><span className="landing-mark">○</span>origen<span>.</span></a><nav aria-label={t('Navigation','Navegación')}><a className="institution-register-link" href="#institutions">{t('Register your institution','Registra tu institución')}</a><a href="#educators">{t('For educators','Para educadores')}</a><a href="#about">{t('About Origen','Acerca de Origen')}</a><a href="#privacy">{t('Data privacy','Privacidad de datos')}</a><button className="landing-language" lang={es?'en':'es'} aria-label={es?'Switch to English':'Ver en español'} onClick={()=>{setEs(!es);setCopyStatus('');}}>{es?'English':'Español'}</button><button className="landing-login" onClick={()=>setLogin(true)}>{t('Sign in','Ingresar')}<ArrowUpRight size={16}/></button></nav></header>
  <main className="landing-main">
   <section className="landing-hero">
    <svg ref={sky} className="hero-sky" viewBox="0 0 1200 160" fill="none" aria-hidden="true" preserveAspectRatio="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round">
     <g className="upper-clouds">
      <path className="upper-cloud" d="M18 100 C83 76 125 101 190 78 S284 66 328 73"/>
      <path className="upper-cloud" d="M366 40 C436 18 473 54 534 36 S623 20 669 29"/>
      <path className="upper-cloud" d="M788 79 C842 57 888 82 933 66 S1032 54 1084 65"/>
      <path className="upper-cloud" d="M1051 24 C1096 12 1134 33 1170 22"/>
     </g>
     {[[60,35,5],[173,122,7],[264,26,4],[347,109,5],[471,81,7],[587,119,4],[718,47,6],[807,124,4],[923,22,5],[1056,112,7],[1142,86,4]].map(([x,y,r],index)=><g className="line-star" key={index} transform={`translate(${x} ${y})`}>
      <path vectorEffect="non-scaling-stroke" d={`M0 ${-r} Q0 0 ${r} 0 Q0 0 0 ${r} Q0 0 ${-r} 0 Q0 0 0 ${-r} Z`}/>
      {index%3===1&&<path vectorEffect="non-scaling-stroke" strokeWidth="0.65" d={`M0 ${-r-4} V${-r-2} M${r+2} 0 H${r+4} M0 ${r+2} V${r+4} M${-r-4} 0 H${-r-2}`}/>}
     </g>)}
    </svg>
    <svg ref={ambient} className="ambient-lines" viewBox="0 0 620 660" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
     <path d="M-20 90 C110 -30 285 120 440 25 C495 -8 550 6 610 30"/>
     <path d="M-20 590 C80 515 92 665 205 605 C295 555 315 645 450 602 C510 583 560 590 630 615"/>
     <path d="M5 510 C85 470 -40 390 21 330 C80 272 -20 189 35 122 C72 77 105 88 148 65"/>
    </svg>
    <div className="landing-copy"><div className="landing-eyebrow"><span/> {t('COLLEGE & TRANSFER GUIDANCE','ORIENTACIÓN PARA LA UNIVERSIDAD Y LA TRANSFERENCIA')}</div><h1>{t('Your next chapter.','Tu próximo capítulo.')}<br/><em>{t('A path that fits.','Un camino para ti.')}</em></h1><p>{t('Starting college, planning a transfer, or supporting someone you care about? Understand your options, applications, and financial aid—with guidance in English and Spanish, at your pace.','¿Vas a empezar la universidad, buscas transferirte o apoyas a alguien cercano? Entiende tus opciones, las solicitudes y la ayuda económica, con orientación en español e inglés y a tu ritmo.')}</p><div className="landing-actions"><button className="landing-primary" onClick={()=>setLogin(true)}>{t('Get started','Empezar')}<ArrowRight size={19}/></button></div><div className="landing-caption">{t('For your own journey. For the people beside you. En español también.','Para tu propio camino. Para quienes te acompañan. También en inglés.')}</div></div>
    <div className="landing-map pueblo-scene">
     <svg ref={line} className="path-drawing" viewBox="0 0 700 570" fill="none" role="img" aria-label={t('A lively pueblo village with people walking, farmers tending fields, and grazing bulls beneath the mountains','Un pueblo lleno de vida, con personas caminando, agricultores trabajando y toros pastando al pie de las montañas')} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <defs><linearGradient id={`${sceneId}-fade`} className="scene-reveal-gradient" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="570" y2="710"><stop offset="0" stopColor="white"/><stop offset="1" stopColor="black"/></linearGradient><mask id={`${sceneId}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width="700" height="570" style={{maskType:'luminance'}}><rect width="700" height="570" fill={`url(#${sceneId}-fade)`} stroke="none"/></mask></defs>
      <g mask={`url(#${sceneId}-reveal)`}>
      {/* Each edge is one continuous stroke: road, village outline, then its mountain ridge. */}
      <path data-side="left" data-duration="7400" d="M296 560 C235 503 410 487 350 443 C329 427 322 411 334 391 C345 368 305 354 265 371 C218 391 151 389 138 361 L138 328 Q138 316 150 316 Q162 316 162 328 L162 364 L235 360 L235 316 L227 316 L227 301 L200 301 L200 316 L190 316 L190 285 L174 285 L174 254 L168 254 L168 239 L113 239 L113 254 L105 254 L105 285 L95 285 L95 323 L62 323 L62 363 M62 323 L62 296 L22 290 L72 230 L92 246 L184 126 L206 152 L248 91 L313 188 L342 159"/>
      <path data-side="right" data-duration="7400" d="M344 560 C287 509 459 493 388 437 C369 422 355 411 368 397 C388 383 419 392 446 374 C468 360 499 356 522 348 L522 308 Q522 298 532 298 Q542 298 542 308 L542 351 L624 347 L624 288 L614 288 L614 267 L580 267 L580 288 L566 288 L566 263 L553 263 L553 238 L490 238 L490 263 L476 263 L476 301 L448 301 L448 346 L476 350 L476 301 M476 263 L566 263 L566 288 L624 288 L644 278 L681 276 L644 226 L621 240 L512 124 L481 144 L455 109 L389 207 L342 159"/>
      <path data-side="left" data-delay="7000" data-duration="1400" d="M95 285 L190 285 M105 254 L174 254 M190 316 L235 316 M95 323 L95 365 M62 363 L138 361 M119 307 L130 307 L130 324 L119 324 Z M169 307 L180 307 L180 324 L169 324 Z M126 263 L137 263 L137 275 L126 275 Z M149 263 L160 263 L160 275 L149 275 Z M205 333 L219 333 L219 350 L205 350 Z M72 336 L83 336 L83 350 L72 350 Z"/>
      <path data-side="right" data-delay="7000" data-duration="1400" d="M490 263 L553 263 M566 288 L624 288 M566 288 L566 347 M476 301 L476 349 M476 350 L522 348 M491 283 L504 283 L504 301 L491 301 Z M548 282 L558 282 L558 299 L548 299 Z M588 308 L601 308 L601 327 L588 327 Z M501 246 L512 246 L512 256 L501 256 Z M532 246 L543 246 L543 256 L532 256 Z M455 316 L464 316 L464 331 L455 331 Z"/>
      <path data-side="left" data-delay="7300" data-duration="1400" d="M206 202 L234 174 L271 221 M309 248 L342 204 M41 402 Q108 412 167 400"/>
      <path data-side="right" data-delay="7300" data-duration="1400" d="M342 204 L368 233 M374 276 L412 222 L453 247 M478 393 Q557 378 664 389"/>
      {/* Smaller stepped homes extend the village without filling the line drawing. */}
      <path data-side="left" data-delay="7900" data-duration="1700" d="M20 347 L20 311 Q20 308 23 308 L52 308 L52 347 M25 308 L25 293 L47 293 L47 308 M29 347 L29 330 Q35 322 41 330 L41 347 M235 355 L269 355 L269 300 L235 300 M242 300 L242 283 L263 283 L263 300 M245 355 L245 333 Q251 325 257 333 L257 355"/>
      <path data-side="right" data-delay="8150" data-duration="1700" d="M624 342 L665 342 L665 305 Q665 302 661 302 L624 302 M633 302 L633 288 L657 288 L657 302 M638 342 L638 325 Q644 317 650 325 L650 342 M448 338 L416 338 L416 289 L448 289 M421 289 L421 275 L442 275 L442 289 M426 338 L426 319 Q431 312 437 319 L437 338"/>
      <path data-side="left" data-delay="9000" data-duration="1500" d="M101 289 L101 297 M115 289 L115 297 M177 289 L177 297 M185 289 L185 297 M108 250 L108 246 M174 250 L174 246 M116 325 L133 325 M166 325 L183 325 M124 309 L124 324 M174 309 L174 324 M239 313 L249 313 L249 324 L239 324 Z M256 312 L264 312 L264 324 L256 324 Z M23 317 L29 317 L29 324 L23 324 Z M44 317 L50 317 L50 324 L44 324 Z M66 359 L91 359 M199 354 L225 354"/>
      <path data-side="right" data-delay="9250" data-duration="1500" d="M480 267 L480 275 M490 267 L490 275 M552 267 L552 275 M562 267 L562 275 M495 284 L495 300 M552 284 L552 299 M587 328 L603 328 M633 311 L639 311 L639 320 L633 320 Z M652 311 L659 311 L659 320 L652 320 Z M421 298 L429 298 L429 308 L421 308 Z M435 298 L443 298 L443 308 L435 308 Z M579 340 L613 340"/>
      <path data-delay="9700" data-duration="1200" d="M287 335 L287 288 M295 335 L295 281 M287 293 L295 291 M287 304 L295 302 M287 315 L295 313 M287 326 L295 324 M399 329 L399 292 M406 329 L406 285 M399 298 L406 295 M399 309 L406 306 M399 320 L406 317"/>
      <path data-delay="9000" data-duration="1300" d="M344 105 A26 26 0 1 1 396 105 A26 26 0 1 1 344 105"/>
      <g className="landscape-contours" strokeWidth="0.8" opacity="0.25">
       <path data-delay="9300" data-duration="2300" d="M25 421 C95 436 152 409 221 418 C251 421 266 433 279 446"/>
       <path data-delay="9700" data-duration="2400" d="M8 447 C85 463 159 438 208 448 C231 453 245 465 248 480"/>
       <path data-delay="10100" data-duration="2100" d="M54 479 C121 481 157 472 190 484 C207 490 219 501 222 512"/>
       <path data-delay="9400" data-duration="2300" d="M449 416 C501 399 568 407 674 421"/>
       <path data-delay="9800" data-duration="2300" d="M447 448 C518 424 598 440 694 454"/>
       <path data-delay="10200" data-duration="2300" d="M438 480 C516 455 572 465 645 480"/>
      </g>
      <g className="landscape-sky" strokeWidth="1.2">
       <path className="sky-drift" d="M110 58 C146 44 192 64 227 50 C246 42 266 38 294 43"/>
       <path className="sky-drift" d="M437 62 C483 49 515 69 545 60 C565 54 585 55 605 61"/>
      </g>
      <g strokeWidth="0.85" opacity="0.6">
       <path className="sun-orbit" data-delay="10400" data-duration="1600" d="M352 69 A41 41 0 0 1 411 107 M407 124 A41 41 0 0 1 377 145"/>
       <path data-delay="10800" data-duration="1400" d="M317 71 Q323 64 330 71 Q337 64 343 71 M575 180 Q581 174 587 180 Q593 174 599 180"/>
      </g>
      <g className="village-life" aria-hidden="true" strokeWidth="1.05">
       <g className="village-crops" strokeWidth="0.9" opacity="0.65">
        {[{x:80,y:431},{x:116,y:438},{x:154,y:445},{x:506,y:438},{x:545,y:443},{x:584,y:449}].map(({x,y},i)=><g key={i} transform={`translate(${x} ${y})`}>
         {[0,8,16].map(offset=><path key={offset} d={`M${offset} 0 V-12 M${offset} -4 Q${offset-6} -7 ${offset-5} -10 M${offset} -7 Q${offset+5} -10 ${offset+5} -13`}/>)}
        </g>)}
       </g>
       {[{x:205,y:453,flip:1},{x:538,y:476,flip:-1}].map(({x,y,flip},index)=><g className="field-worker" key={index} transform={`translate(${x} ${y}) scale(${flip*0.9} 0.9)`}>
        <path className="life-ink" d="M0 -10 L-5 0 M0 -10 L6 0"/>
        <g className="farmer-upper">
         <circle cx="0" cy="-26" r="3.5"/>
         <path className="life-ink" d="M-8 -28 Q0 -31 8 -28 M-4 -30 L-3 -35 L4 -35 L5 -29 M0 -22 L0 -10 M-3 -20 L-3 -12 L4 -12 L4 -20 M0 -20 L7 -15 L14 -16 M0 -18 L5 -12 L11 -11 M13 -21 L22 -1 L28 -1"/>
        </g>
       </g>)}
       <path className="life-route life-route-0" d="M150 389 Q180 392 210 389"/>
       <path className="life-route life-exit-0" d="M210 389 Q180 386 150 389"/>
       <path className="life-route life-route-1" d="M420 389 Q435 392 450 389"/>
       <path className="life-route life-exit-1" d="M450 389 Q435 386 420 389"/>
       <path className="life-route life-route-2" d="M554 390 Q584 393 618 390"/>
       <path className="life-route life-exit-2" d="M618 390 Q584 387 554 390"/>
       <path className="life-route life-route-3" d="M260 418 Q281 421 302 418"/>
       <path className="life-route life-exit-3" d="M302 418 Q281 415 260 418"/>
       <path className="life-route life-route-4" d="M48 398 Q72 401 98 398"/>
       <path className="life-route life-exit-4" d="M98 398 Q72 395 48 398"/>
       <path className="life-route life-route-5" d="M512 389 Q495 392 478 389"/>
       <path className="life-route life-exit-5" d="M478 389 Q495 386 512 389"/>
       <path className="life-route life-route-8" d="M288 389 Q263 392 238 389"/>
       <path className="life-route life-exit-8" d="M238 389 Q263 386 288 389"/>
       <path className="life-route life-route-6" d="M332 550 Q344 532 350 514"/>
       <path className="life-route life-exit-6" d="M350 514 Q338 532 332 550"/>
       <path className="life-route life-route-7" d="M348 435 Q358 452 372 463"/>
       <path className="life-route life-exit-7" d="M372 463 Q354 451 348 435"/>
       <path className="life-route life-route-9" d="M258 465 Q269 469 280 475"/>
       <path className="life-route life-exit-9" d="M280 475 Q269 467 258 465"/>
       <path className="life-route life-route-10" d="M456 500 Q468 502 480 500"/>
       <path className="life-route life-exit-10" d="M480 500 Q468 498 456 500"/>
       <path className="life-route life-route-12" d="M91 509 Q115 512 140 509"/>
       <path className="life-route life-exit-12" d="M140 509 Q115 506 91 509"/>
       <path className="life-route life-route-13" d="M590 520 Q610 523 630 520"/>
       <path className="life-route life-exit-13" d="M630 520 Q610 517 590 520"/>
       {villageResidents.map(({route:index,kind,x,y})=><g className="village-visitor village-resident" data-route={index} data-kind={kind} key={index} transform={`translate(${x} ${y}) scale(${index===4?0.63:0.84})`}>
        <circle cx="0" cy="-24" r="3.4"/>
        <path className="life-ink" d="M0 -20 L0 -10"/>
        <path className="life-ink walking-arm" d="M0 -18 L-4 -12"/><path className="life-ink walking-arm" d="M0 -18 L4 -12"/>
        <path className="life-ink walking-leg" d="M0 -10 L-4 0"/><path className="life-ink walking-leg" d="M0 -10 L4 0"/>
        {kind==='farmer'&&<>
         <path className="life-ink" d="M-7 -26 Q0 -29 7 -26 M-4 -28 L-3 -32 L3 -32 L4 -28 M-3 -18 L-3 -11 L3 -11 L3 -18 M-3 -14 L3 -14"/>
         <path className="life-ink" d="M5 -13 L10 -12 L9 -7 L5 -7 Z M6 -13 Q7 -16 9 -13"/>
        </>}
        {kind==='lady'&&<>
         <path className="life-ink" d="M-4 -22 Q-7 -30 0 -29 Q6 -28 4 -21 M-3 -18 L-6 -9 Q0 -7 6 -9 L3 -18 M-3 -20 L0 -16 L3 -20"/>
         <path className="life-ink" d="M4 -13 Q10 -15 11 -11 L10 -7 L5 -7 Z"/>
        </>}
        {kind==='student'&&<path className="life-ink" d="M-2 -20 Q-8 -22 -8 -15 L-7 -10 L-2 -11 Z M2 -17 L6 -15 L6 -9 L2 -10 Z"/>}
       </g>)}
       <g className="village-visitor village-animal" data-route="2" data-kind="burro" transform="translate(584 390) scale(0.78)">
        <path className="life-ink" d="M-13 -11 Q-17 -20 -10 -21 L7 -21 L13 -29 L20 -30 Q24 -28 23 -24 L18 -22 L15 -11 Z M13 -29 L11 -39 Q14 -41 16 -31 M18 -30 L19 -40 Q23 -40 22 -31 M-14 -19 Q-21 -21 -20 -12 M-8 -23 Q-3 -26 3 -23"/>
        <path className="life-ink" d="M20 -27 L21 -27 M-6 -22 L-6 -14 L5 -14 L5 -22"/>
        {[0,1,2,3].map(i=><path key={i} className="life-ink walking-leg" d={`M${i<2?-9:10} -11 L${i<2?-9:10} 0`}/>)}
       </g>
       <g className="village-visitor village-animal" data-route="3" data-kind="dog" transform="translate(280 418) scale(0.72)">
        <path className="life-ink" d="M-9 -7 L-9 -14 L8 -14 L12 -20 L18 -19 L22 -16 L17 -13 L12 -7 Z M12 -19 L10 -24 L16 -21 M-9 -13 Q-16 -20 -16 -14 M18 -17 L19 -17"/>
        {[0,1,2,3].map(i=><path key={i} className="life-ink walking-leg" d={`M${i<2?-6:7} -7 L${i<2?-6:7} 0`}/>)}
       </g>
       {[{route:12,x:115,y:509},{route:13,x:610,y:520}].map(({route,x,y})=><g className="village-visitor village-animal" data-route={route} data-kind="bull" key={route} transform={`translate(${x} ${y}) scale(0.94)`}>
        <path className="life-ink" d="M-17 -12 L-17 -23 Q-12 -28 -4 -26 L7 -25 Q13 -30 17 -24 L16 -12 Q4 -8 -7 -12 Z M-10 -26 Q-5 -31 1 -26"/>
        <path className="life-ink animal-tail" d="M-17 -24 Q-25 -26 -24 -16 L-26 -12 M-26 -14 L-28 -10 L-24 -11"/>
        <g className="grazing-head"><path className="life-ink" d="M12 -22 L21 -25 Q29 -25 28 -18 L25 -12 L18 -13 L13 -17 M18 -24 Q12 -27 13 -32 Q17 -29 20 -27 M25 -25 Q31 -27 32 -32 Q35 -26 29 -22 M24 -20 L25 -20 M19 -15 Q23 -17 27 -15"/></g>
        {[0,1,2,3].map(i=><path key={i} className="life-ink walking-leg" d={`M${i<2?-11:10} -12 L${i<2?-11:10} 0`}/>)}
       </g>)}
      </g>
      </g>
     </svg>
     <div className="scene-caption"><span>{t('MANY PATHS. ONE COMMUNITY.','MUCHOS CAMINOS. UNA COMUNIDAD.')}</span><div><button className="motion-toggle" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?t('Play','Reproducir'):t('Pause','Pausar')}</button><button className="path-replay" onClick={()=>setReplay(n=>n+1)}>{t('Replay ↗','Repetir ↗')}</button></div></div>
    </div>
   </section>
   <section className="landing-resource landing-conversation" id="college-guidance" aria-labelledby="resource-title">
    <div className="landing-conversation-heading">
     <span className="landing-eyebrow">{t('COLLEGE GUIDANCE, THROUGH CONVERSATION','ORIENTACIÓN UNIVERSITARIA, CONVERSANDO')}</span>
     <h2 id="resource-title">{t('College questions? Let’s talk them through.','¿Preguntas sobre la universidad? Conversemos.')}</h2>
     <p>{t('Origen is an AI voice assistant that helps students and families make sense of college—in English or Spanish.','Origen es un asistente de voz con inteligencia artificial que ayuda a estudiantes y familias a entender el camino a la universidad, en español o inglés.')}</p>
    </div>
    <div className="landing-conversation-rows">
     <div className="landing-conversation-row">
      <div className="landing-conversation-copy">
       <h3>{t('Share your goals and what you want to understand','Comparte tus metas y lo que quieres entender')}</h3>
       <p>{t('Tell Origen where you are in your college journey and what you’d like help with.','Cuéntale a Origen en qué parte de tu camino a la universidad estás y en qué te gustaría recibir ayuda.')}</p>
      </div>
      <LandingVideo t={t}/>
     </div>
     <div className="landing-conversation-row">
      <div className="landing-conversation-copy">
       <h3>{t('Make sense of unfamiliar terms','Entiende los términos que no conoces')}</h3>
       <p>{t('Ask questions about college, financial aid, transfer requirements, or applications. Origen explains unfamiliar ideas in everyday language.','Pregunta sobre la universidad, la ayuda económica, los requisitos de transferencia o las solicitudes de ingreso. Origen explica las ideas que no conoces con palabras sencillas.')}</p>
      </div>
      <LandingVideo variant="college-costs" t={t}/>
     </div>
     <div className="landing-conversation-row">
      <div className="landing-conversation-copy">
       <h3>{t('Review your notes and next steps','Revisa tus notas y próximos pasos')}</h3>
       <p>{t('Return to your binder to revisit what you discussed and keep your questions together.','Vuelve a tu carpeta para repasar lo que conversaste y reunir tus preguntas en un solo lugar.')}</p>
      </div>
      <LandingVideoPlaceholder title={t('Binder walkthrough','Recorrido por la carpeta')} t={t}/>
     </div>
    </div>
    <div className="landing-conversation-footer">
     <p className="landing-reassurance">{t('You don’t have to know where to start. We can start there together.','No tienes que saber por dónde empezar. Podemos descubrirlo juntos.')}</p>
     <div className="landing-actions landing-start-actions"><button className="landing-primary" onClick={()=>setLogin(true)}>{t('Get started with Origen','Empieza con Origen')}<ArrowRight size={18}/></button></div>
    </div>
   </section>
   <section className="landing-resource" id="how" aria-labelledby="how-title">
    <span className="landing-eyebrow">{t('GETTING STARTED','PARA EMPEZAR')}</span><h2 id="how-title">{t('A conversation today. Something to build on tomorrow.','Una conversación hoy. Un punto de partida para mañana.')}</h2>
    <ol className="landing-resource-grid landing-how">
     <li><h3>{t('Tell us a little about yourself.','Cuéntanos un poco de ti.')}</h3><p>{t('Create your account and share where you are in your college journey—or who you’re supporting.','Crea tu cuenta y cuéntanos en qué parte de tu camino a la universidad estás, o a quién estás apoyando.')}</p></li>
     <li><h3>{t('Press Talk and start anywhere.','Presiona Hablar y empieza por donde quieras.')}</h3><p>{t('Speak naturally in English or Spanish. Origen answers questions, explains unfamiliar ideas, and helps guide the conversation at your pace.','Habla con naturalidad en español o inglés. Origen responde preguntas, explica ideas que no conoces y te ayuda a llevar la conversación a tu ritmo.')}</p></li>
     <li><h3>{t('Keep your thoughts together.','Reúne tus ideas en un solo lugar.')}</h3><p>{t('Your binder brings conversation summaries and key points together by topic. Add your own notes and questions, revisit them later, or download a PDF to bring to your next meeting.','Tu carpeta reúne resúmenes de conversaciones y puntos clave por tema. Agrega tus propias notas y preguntas, vuelve a consultarlas después o descarga un PDF para llevar a tu próxima reunión.')}</p></li>
    </ol>
   </section>
   <section className="landing-resource" id="educators" aria-labelledby="educators-title">
    <span className="landing-eyebrow">{t('FOR EDUCATORS AND OUTREACH TEAMS','PARA EDUCADORES Y EQUIPOS DE DIFUSIÓN')}</span>
    <h2 id="educators-title">{t('Help students keep moving between meetings.','Ayuda a tus estudiantes a seguir avanzando entre reuniones.')}</h2>
    <p>{t('Give students and families a place to ask follow-up questions, revisit explanations, and organize what they want to discuss with you. Origen supports the learning between appointments, helping students arrive with clearer questions and notes they can choose to share.','Ofrece a estudiantes y familias un espacio para hacer las preguntas que surgen después, repasar explicaciones y organizar lo que quieren conversar contigo. Origen apoya el aprendizaje entre citas para que lleguen con preguntas más claras y notas que pueden decidir compartir.')}</p>
    <p>{t('Origen complements the support your team provides. Students and families should confirm requirements and deadlines with the college or official aid provider.','Origen complementa el apoyo de tu equipo. Estudiantes y familias deben confirmar los requisitos y las fechas límite con la institución o el proveedor oficial de ayuda.')}</p>
    <div className="landing-actions"><button className="landing-primary" onClick={()=>void copy(shareDescription)}>{t('Copy description','Copiar descripción')}</button><button className="landing-primary" onClick={()=>void copy('https://origenedu.ai')}>{t('Copy link','Copiar enlace')}</button></div>
    <p className="landing-share-description">{shareDescription}</p><p role="status" aria-live="polite">{copyStatus}</p>
    <a className="landing-share-link" href="https://origenedu.ai">origenedu.ai <ArrowUpRight size={16}/></a>
   </section>
   <LandingStory t={t}/>
   <LandingDetails t={t} section="contact"/>
   <section className="landing-closing"><h2>{t('You belong in this conversation.','Tu voz tiene un lugar aquí.')}</h2><button onClick={()=>setLogin(true)}>{t('Let’s get started','Empecemos')}<ArrowRight size={18}/></button></section>
  </main>
  <footer className="landing-footer"><strong>origen.</strong><a href="#institutions">{t('Register your institution','Registra tu institución')}</a>{publicContactEmail&&<a href="#contact">{t('Contact','Contacto')}</a>}<a href="#about">{t('About Origen','Acerca de Origen')}</a><a href="#privacy">{t('Data privacy','Privacidad de datos')}</a><span>{t('Origen Edu is operated by Blueprint Holdings LLC.','Origen Edu es operado por Blueprint Holdings LLC.')}{publicContactEmail&&<> <a href={`mailto:${publicContactEmail}`}>{publicContactEmail}</a></>}</span><button onClick={()=>signIn(true)}>{t('Create an account','Crear una cuenta')}<ArrowUpRight size={14}/></button></footer>
  <dialog ref={dialog} className="landing-dialog landing-auth-dialog" aria-label={t('Sign in or create an account','Iniciar sesión o crear una cuenta')} onCancel={()=>setLogin(false)}><button className="dialog-close" aria-label={t('Close','Cerrar')} onClick={()=>setLogin(false)}><X size={22}/></button><div className="landing-auth-actions"><button className="landing-primary" disabled={isLoading} onClick={()=>signIn()}>{t('Sign in','Iniciar sesión')}<ArrowRight size={18}/></button><button className="landing-primary" disabled={isLoading} onClick={()=>signIn(true)}>{t('Create an account','Crear una cuenta')}<ArrowRight size={18}/></button></div>{(signinError||error)&&<p role="alert">{t('Could not sign in. Try again.','No se pudo iniciar sesión. Intenta de nuevo.')}</p>}</dialog>
 </div>;
}
