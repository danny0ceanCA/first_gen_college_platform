import LandingStory from './LandingStory';
import LandingDetails,{publicContactEmail} from './LandingDetails';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {animate} from 'animejs';
import {ArrowRight,ArrowUpRight,X} from 'lucide-react';
import './Landing.css';
export default function Landing({enter}:{enter:()=>void}){
 const {loginWithRedirect,isLoading,error}=useAuth0();
 const [copyStatus,setCopyStatus]=useState('');
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopyStatus(t('Copied. Ready to share.','Copiado. Listo para compartir.'));}catch{setCopyStatus(t('Copy was unavailable. Select the description or link below to copy it.','No se pudo copiar. Selecciona la descripción o el enlace para copiarlo.'));}};
 const [signinError,setSigninError]=useState(false);
 const signIn=()=>{setSigninError(false);void loginWithRedirect({authorizationParams:{connection:'sms',ui_locales:es?'es':'en'}}).catch(()=>setSigninError(true));};
 const [es,setEs]=useState(()=>localStorage.getItem('origen.language')==='es'),[login,setLogin]=useState(false),[replay,setReplay]=useState(0),[paused,setPaused]=useState(false);
 const motion=useRef<ReturnType<typeof animate>[]>([]),pauseRef=useRef(false),heroVisible=useRef(true);
 const line=useRef<SVGSVGElement>(null),ambient=useRef<SVGSVGElement>(null),sky=useRef<SVGSVGElement>(null),dialog=useRef<HTMLDialogElement>(null);
 const t=(en:string,sp:string)=>es?sp:en;
 useEffect(()=>{document.documentElement.lang=es?'es':'en';localStorage.setItem('origen.language',es?'es':'en');},[es]);
 useLayoutEffect(()=>{
  if(!line.current||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const scene=line.current;
  const animations:ReturnType<typeof animate>[]=[];
  const originals=Array.from(scene.querySelectorAll<SVGPathElement>('path:not(.sky-drift):not(.life-route):not(.life-ink)'));
  const fragments:SVGPathElement[]=[];
  type Stroke={path:SVGPathElement;length:number;start:DOMPoint;end:DOMPoint};
  const routes:Stroke[][]=[[],[]];
  // Each pen owns a queue of strokes. No detail has its own animation clock.
  originals.forEach(original=>{
   const parts=original.getAttribute('d')!.match(/M[^M]*/g)||[];
   parts.forEach(d=>{
    const path=original.cloneNode() as SVGPathElement;
    path.setAttribute('d',d);path.classList.add('pen-stroke');
    original.parentNode!.insertBefore(path,original);
    const length=path.getTotalLength(),start=path.getPointAtLength(0),end=path.getPointAtLength(length);
    const side=original.dataset.side;
    const index=side==='left'?0:side==='right'?1:(start.x<350?0:1);
    path.style.strokeDasharray=`${length} ${length}`;
    path.style.strokeDashoffset=String(length);
    routes[index].push({path,length,start,end});fragments.push(path);
   });
   original.style.visibility='hidden';
  });
  routes.forEach((route,index)=>{
   const tip=scene.querySelector<SVGCircleElement>(`.drawing-tip-${index}`)!;
   let total=0,previous=route[0].start;
   const steps=route.map(stroke=>{
    // Lift and move the same pen between disconnected architectural details.
    const travel=Math.min(50,Math.hypot(stroke.start.x-previous.x,stroke.start.y-previous.y));
    const step={...stroke,from:previous,begin:total,ink:total+travel,finish:total+travel+stroke.length};
    total=step.finish;previous=stroke.end;return step;
   });
   const pen={distance:0};
   animations.push(animate(pen,{distance:[0,total],duration:total/0.22,delay:index*220,ease:'linear',
    onUpdate:()=>{
     const active=steps.find(step=>pen.distance<=step.finish)||steps[steps.length-1];
     steps.forEach(step=>{step.path.style.strokeDashoffset=String(step.length-Math.max(0,Math.min(step.length,pen.distance-step.ink)));});
     const drawing=pen.distance>=active.ink;
     const fraction=Math.max(0,Math.min(1,(pen.distance-active.begin)/(active.ink-active.begin||1)));
     const point=drawing?active.path.getPointAtLength(pen.distance-active.ink):{x:active.from.x+(active.start.x-active.from.x)*fraction,y:active.from.y+(active.start.y-active.from.y)*fraction};
     tip.setAttribute('cx',String(point.x));tip.setAttribute('cy',String(point.y));
     tip.style.opacity=drawing?'1':'0.25';
    },onComplete:()=>{tip.style.opacity='0';}}));
  });
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
  // Staggered walks keep at most two people visible; nobody waits in a crowd.
  const residents=Array.from(scene.querySelectorAll<SVGGElement>('.village-visitor')).filter(visitor=>!['burro','dog'].includes(visitor.dataset.kind!)).map((visitor,order)=>{
   const index=Number(visitor.dataset.route);
   const arrival=scene.querySelector<SVGPathElement>(`.life-route-${index}`)!;
   const departure=scene.querySelector<SVGPathElement>(`.life-exit-${index}`)!;
   return {visitor,index,order,arrival,departure,arrivalLength:arrival.getTotalLength(),departureLength:departure.getTotalLength(),
    legs:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),
    arms:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-arm'))};
  });
  const village={time:0};
  animations.push(animate(village,{time:[0,1],duration:64000,delay:30000,loop:true,ease:'linear',onUpdate:()=>{
   residents.forEach(({visitor,index,order,arrival,departure,arrivalLength,departureLength,legs,arms})=>{
    const phase=(village.time+order/residents.length)%1;
    const travel=Math.min(1,phase/0.30),totalLength=arrivalLength+departureLength;
    const travelled=totalLength*travel,leaving=travelled>=arrivalLength;
    const route=leaving?departure:arrival,length=leaving?departureLength:arrivalLength;
    const distance=leaving?travelled-arrivalLength:travelled,point=route.getPointAtLength(distance);
    const next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
    const facing=next.x<previous.x?-1:1,stride=Math.sin(travelled*0.46);
    const fade=Math.max(0,Math.min(1,phase/0.018,(0.30-phase)/0.018));
    const scale=index===4?0.63:index>=6?0.90-travel*0.12:0.78;
    visitor.dataset.activity=fade>0?'walking':'away';
    visitor.style.opacity=String(fade*0.9);
    visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
    legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1);leg.setAttribute('d',`M0 -10 L${swing*3} -5 L${swing*5} 0`);});
    arms.forEach((arm,i)=>{const swing=stride*(i?1:-1);arm.setAttribute('d',`M0 -18 L${swing*3} -14 L${swing*5} -12`);});
   });
  }}));
  // Animals wander continuously on independent clocks.
  scene.querySelectorAll<SVGGElement>('.village-visitor[data-kind="burro"],.village-visitor[data-kind="dog"]').forEach(visitor=>{
   const index=Number(visitor.dataset.route),burro=visitor.dataset.kind==='burro';
   const outward=scene.querySelector<SVGPathElement>(`.life-route-${index}`)!,homeward=scene.querySelector<SVGPathElement>(`.life-exit-${index}`)!;
   const outwardLength=outward.getTotalLength(),homewardLength=homeward.getTotalLength();
   const legs=Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),wander={time:0};
   animations.push(animate(wander,{time:[0,1],duration:burro?38000:27000,delay:burro?30000:33000,loop:true,ease:'linear',onUpdate:()=>{
    const back=wander.time>=0.5,progress=back?(wander.time-0.5)*2:wander.time*2;
    const route=back?homeward:outward,length=back?homewardLength:outwardLength,distance=length*progress;
    const point=route.getPointAtLength(distance),next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
    const facing=next.x<previous.x?-1:1,stride=Math.sin((distance+(back?outwardLength:0))*0.44),scale=burro?0.72:0.68;
    visitor.dataset.activity='walking';visitor.style.opacity='0.9';
    visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
    legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1),hip=burro?(i<2?-9:10):(i<2?-6:7),top=burro?-11:-7;leg.setAttribute('d',`M${hip} ${top} L${hip+swing*2.5} -5 L${hip+swing*4} 0`);});
   }}));
  });
  motion.current=animations;
  const syncVisibility=()=>animations.forEach(a=>{if(pauseRef.current||!heroVisible.current||document.hidden)a.pause();else if(!a.completed)a.play();});
  const observer=new IntersectionObserver(([entry])=>{heroVisible.current=entry.isIntersecting;syncVisibility();},{rootMargin:'80px'});
  observer.observe(scene.closest('.landing-hero')!);document.addEventListener('visibilitychange',syncVisibility);syncVisibility();
  return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',syncVisibility);animations.forEach(animation=>animation.revert());fragments.forEach(path=>path.remove());originals.forEach(path=>path.style.removeProperty('visibility'));motion.current=[];};
 },[replay]);
 useEffect(()=>{
  pauseRef.current=paused;
  motion.current.forEach(animation=>{if(paused||!heroVisible.current||document.hidden)animation.pause();else if(!animation.completed)animation.play();});
 },[paused]);
 useEffect(()=>{if(login)dialog.current?.showModal();else dialog.current?.close();},[login]);
 return <div className="landing">
  <header className="landing-nav"><a className="landing-logo" href="#" aria-label="Origen"><span className="landing-mark">○</span>origen<span>.</span></a><nav aria-label={t('Navigation','Navegación')}><a className="institution-register-link" href="#institutions">{t('Register your institution','Registra tu institución')}</a><a href="#educators">{t('For educators','Para educadores')}</a><a href="#about">{t('About Origen','Acerca de Origen')}</a><a href="#how">{t('How it works','Cómo funciona')}</a><button className="landing-language" lang={es?'en':'es'} aria-label={es?'Switch to English':'Ver en español'} onClick={()=>{setEs(!es);setCopyStatus('');}}>{es?'English':'Español'}</button><button className="landing-login" onClick={()=>setLogin(true)}>{t('Sign in','Ingresar')}<ArrowUpRight size={16}/></button></nav></header>
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
    <div className="landing-copy"><div className="landing-eyebrow"><span/> {t('COLLEGE GUIDANCE FOR STUDENTS AND FAMILIES','ORIENTACIÓN UNIVERSITARIA PARA ESTUDIANTES Y FAMILIAS')}</div><h1>{t('Their next chapter.','Su próximo capítulo.')}<br/><em>{t('Your journey, too.','También es tu camino.')}</em></h1><p>{t('Origen helps students and families understand college—from exploring their options and navigating applications to making sense of financial aid and costs—with guidance in English and Spanish.','Origen ayuda a estudiantes y familias a entender la universidad: desde explorar sus opciones y orientarse en las solicitudes hasta comprender la ayuda económica y los costos, con orientación en inglés y español.')}</p><div className="landing-actions"><button className="landing-primary" onClick={()=>setLogin(true)}>{t('Get started','Empezar')}<ArrowRight size={19}/></button><button className="landing-preview-link" onClick={enter}>{t('Explore without signing in','Explorar sin iniciar sesión')}<ArrowUpRight size={17}/></button></div><p className="landing-preview-note">{t('Preview a sample family without an account. Sign in for AI guidance and account features.','Explora una familia de ejemplo sin una cuenta. Inicia sesión para usar orientación de IA y funciones de cuenta.')}</p><div className="landing-caption">{t('For students. For families. En español también.','Para estudiantes. Para familias. También en inglés.')}</div></div>
    <div className="landing-map pueblo-scene">
     <svg ref={line} className="path-drawing" viewBox="0 0 700 570" fill="none" role="img" aria-label={t('Two edges of a winding path each draw their own pueblo village and mountains','Dos bordes de un camino dibujan cada uno su pueblo y sus montañas')} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
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
      <g className="landscape-contours" strokeWidth="0.8" opacity="0.42">
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
       <path data-delay="10400" data-duration="1600" d="M352 69 A41 41 0 0 1 411 107 M407 124 A41 41 0 0 1 377 145"/>
       <path data-delay="10800" data-duration="1400" d="M317 71 Q323 64 330 71 Q337 64 343 71 M575 180 Q581 174 587 180 Q593 174 599 180"/>
      </g>
      <g className="village-life" aria-hidden="true" strokeWidth="1.05">
       <path className="life-route life-route-0" d="M150 363 Q165 378 209 373 Q253 363 280 373"/>
       <path className="life-route life-exit-0" d="M280 373 Q242 391 203 372 L150 363"/>
       <path className="life-route life-route-1" d="M532 352 Q496 366 441 371 Q367 387 300 375"/>
       <path className="life-route life-exit-1" d="M300 375 Q357 404 410 382 Q470 366 532 352"/>
       <path className="life-route life-route-2" d="M644 346 Q591 365 530 365 Q470 363 424 376"/>
       <path className="life-route life-exit-2" d="M424 376 Q466 389 531 371 Q590 360 644 346"/>
       <path className="life-route life-route-3" d="M252 358 Q256 386 279 399 Q304 405 321 391"/>
       <path className="life-route life-exit-3" d="M321 391 Q310 411 268 385 L252 358"/>
       <path className="life-route life-route-4" d="M35 350 Q89 377 160 378 Q227 397 280 391"/>
       <path className="life-route life-exit-4" d="M280 391 Q215 401 157 383 Q76 365 35 350"/>
       <path className="life-route life-route-5" d="M431 342 Q421 366 392 375 Q347 405 300 393"/>
       <path className="life-route life-exit-5" d="M300 393 Q348 416 400 379 L431 342"/>
       <path className="life-route life-route-6" d="M318 552 C264 507 426 487 367 440 C346 422 336 408 350 393 Q327 382 270 379"/>
       <path className="life-route life-exit-6" d="M270 379 Q232 376 209 371 L150 363"/>
       <path className="life-route life-route-7" d="M331 563 C277 518 442 495 379 446 C354 427 348 411 360 399 Q343 395 314 394"/>
       <path className="life-route life-exit-7" d="M314 394 Q376 404 430 379 Q483 362 532 352"/>
       {[0,1,4,5,6,7].map(index=><g className="village-visitor" data-route={index} data-kind={index===1||index===6?'farmer':index===0||index===7?'lady':'person'} key={index}>
        <circle cx="0" cy="-24" r="3.4"/>
        <path className="life-ink" d="M0 -20 L0 -10"/>
        <path className="life-ink walking-arm" d="M0 -18 L-4 -12"/><path className="life-ink walking-arm" d="M0 -18 L4 -12"/>
        <path className="life-ink walking-leg" d="M0 -10 L-4 0"/><path className="life-ink walking-leg" d="M0 -10 L4 0"/>
        {(index===1||index===6)&&<>
         <path className="life-ink" d="M-7 -26 Q0 -29 7 -26 M-4 -28 L-3 -32 L3 -32 L4 -28 M-3 -18 L-3 -11 L3 -11 L3 -18 M-3 -14 L3 -14"/>
         <path className="life-ink" d="M5 -13 L10 -12 L9 -7 L5 -7 Z M6 -13 Q7 -16 9 -13"/>
        </>}
        {(index===0||index===7)&&<>
         <path className="life-ink" d="M-4 -22 Q-7 -30 0 -29 Q6 -28 4 -21 M-3 -18 L-6 -9 Q0 -7 6 -9 L3 -18 M-3 -20 L0 -16 L3 -20"/>
         <path className="life-ink" d="M4 -13 Q10 -15 11 -11 L10 -7 L5 -7 Z"/>
        </>}
       </g>)}
       <g className="village-visitor" data-route="2" data-kind="burro">
        <path className="life-ink" d="M-13 -11 Q-17 -20 -10 -21 L7 -21 L13 -29 L20 -30 Q24 -28 23 -24 L18 -22 L15 -11 Z M13 -29 L11 -39 Q14 -41 16 -31 M18 -30 L19 -40 Q23 -40 22 -31 M-14 -19 Q-21 -21 -20 -12 M-8 -23 Q-3 -26 3 -23"/>
        <path className="life-ink" d="M20 -27 L21 -27 M-6 -22 L-6 -14 L5 -14 L5 -22"/>
        {[0,1,2,3].map(i=><path key={i} className="life-ink walking-leg" d={`M${i<2?-9:10} -11 L${i<2?-9:10} 0`}/>)}
       </g>
       <g className="village-visitor" data-route="3" data-kind="dog">
        <path className="life-ink" d="M-9 -7 L-9 -14 L8 -14 L12 -20 L18 -19 L22 -16 L17 -13 L12 -7 Z M12 -19 L10 -24 L16 -21 M-9 -13 Q-16 -20 -16 -14 M18 -17 L19 -17"/>
        {[0,1,2,3].map(i=><path key={i} className="life-ink walking-leg" d={`M${i<2?-6:7} -7 L${i<2?-6:7} 0`}/>)}
       </g>
      </g>
      <circle className="drawing-tip drawing-tip-0" r="3" opacity="0" strokeWidth="0.9"/>
      <circle className="drawing-tip drawing-tip-1" r="3" opacity="0" strokeWidth="0.9"/>
     </svg>
     <div className="scene-caption"><span>{t('MANY PATHS. ONE COMMUNITY.','MUCHOS CAMINOS. UNA COMUNIDAD.')}</span><div><button className="motion-toggle" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?t('Play','Reproducir'):t('Pause','Pausar')}</button><button className="path-replay" onClick={()=>setReplay(n=>n+1)}>{t('Replay ↗','Repetir ↗')}</button></div></div>
    </div>
   </section>
   <section className="landing-resource" aria-labelledby="resource-title">
    <span className="landing-eyebrow">{t('COLLEGE QUESTIONS, CLEARER NEXT STEPS','PREGUNTAS UNIVERSITARIAS, PASOS MÁS CLAROS')}</span>
    <h2 id="resource-title">{t('A place to begin. Room to ask.','Un lugar para empezar. Espacio para preguntar.')}</h2>
    <div className="landing-resource-grid">
     <article><h3>{t('Understand college costs','Entiende los costos universitarios')}</h3><p>{t('Learn how FAFSA, financial aid offers, and college costs fit together.','Aprende cómo se relacionan FAFSA, las ofertas de ayuda económica y los costos universitarios.')}</p></article>
     <article><h3>{t('Navigate applications','Oriéntate en las solicitudes')}</h3><p>{t('Find official application portals for UC, Cal State, Common App, and California community colleges.','Encuentra los portales oficiales de UC, Cal State, Common App y los colegios comunitarios de California.')}</p></article>
     <article><h3>{t('Ask in your language','Pregunta en tu idioma')}</h3><p>{t('Explore explanations in English and Spanish, with AI guidance to help you understand unfamiliar steps.','Explora explicaciones en inglés y español, con orientación de IA para entender los pasos que no conoces.')}</p></article>
    </div>
   </section>
   <section className="landing-resource" id="how" aria-labelledby="how-title">
    <span className="landing-eyebrow">{t('HOW IT WORKS','CÓMO FUNCIONA')}</span><h2 id="how-title">{t('Start with one question.','Empieza con una pregunta.')}</h2>
    <ol className="landing-resource-grid landing-how"><li><h3>{t('Explore a topic','Explora un tema')}</h3><p>{t('Begin with college costs, financial aid, or applications. Preview the experience with a sample family.','Empieza con costos universitarios, ayuda económica o solicitudes. Explora la experiencia con una familia de ejemplo.')}</p></li><li><h3>{t('Ask your questions','Haz tus preguntas')}</h3><p>{t('Sign in to use AI guidance. Ask in English or Spanish and revisit anything unfamiliar.','Inicia sesión para usar la orientación de IA. Pregunta en inglés o español y vuelve a lo que no conozcas.')}</p></li><li><h3>{t('Follow official resources','Consulta recursos oficiales')}</h3><p>{t('Use source links to keep researching and confirm requirements with the college or aid provider.','Usa los enlaces para seguir investigando y confirma los requisitos con la institución o el proveedor de ayuda.')}</p></li></ol>
   </section>
   <LandingStory t={t}/>
   <section className="landing-resource" id="educators" aria-labelledby="educators-title">
    <span className="landing-eyebrow">{t('FOR EDUCATORS AND OUTREACH TEAMS','PARA EDUCADORES Y EQUIPOS DE DIFUSIÓN')}</span>
    <h2 id="educators-title">{t('A resource worth passing along.','Un recurso para compartir.')}</h2>
    <p>{t('Supporting students and families through outreach or enrollment? Explore Origen and share it as an additional resource for understanding college costs, financial aid, and applications.','¿Apoyas a estudiantes y familias durante la difusión o la inscripción? Explora Origen y compártelo como un recurso adicional para entender los costos universitarios, la ayuda económica y las solicitudes.')}</p>
    <p>{t('Origen complements the support your team provides. Students and families should confirm requirements and deadlines with the college or official aid provider.','Origen complementa el apoyo de tu equipo. Estudiantes y familias deben confirmar los requisitos y las fechas límite con la institución o el proveedor oficial de ayuda.')}</p>
    <div className="landing-actions"><button className="landing-primary" onClick={()=>void copy(t('Origen helps students and families understand college, financial aid, and applications with guidance in English and Spanish. Explore it at https://origenedu.ai','Origen ayuda a estudiantes y familias a entender la universidad, la ayuda económica y las solicitudes con orientación en inglés y español. Explóralo en https://origenedu.ai'))}>{t('Copy description','Copiar descripción')}</button><button className="landing-primary" onClick={()=>void copy('https://origenedu.ai')}>{t('Copy link','Copiar enlace')}</button></div>
    <p className="landing-share-description">{t('Origen helps students and families understand college, financial aid, and applications with guidance in English and Spanish. Explore it at https://origenedu.ai','Origen ayuda a estudiantes y familias a entender la universidad, la ayuda económica y las solicitudes con orientación en inglés y español. Explóralo en https://origenedu.ai')}</p><p role="status" aria-live="polite">{copyStatus}</p>
    <a className="landing-share-link" href="https://origenedu.ai">origenedu.ai <ArrowUpRight size={16}/></a>
   </section>
   <section className="landing-resource" id="about" aria-labelledby="about-title">
    <span className="landing-eyebrow">{t('ABOUT ORIGEN','ACERCA DE ORIGEN')}</span>
    <h2 id="about-title">{t('A path forward, together.','Un camino adelante, juntos.')}</h2>
    <p>{t('Origen helps students and families understand college—from exploring their options and navigating applications to making sense of financial aid and costs—with guidance in English and Spanish.','Origen ayuda a estudiantes y familias a entender la universidad: desde explorar sus opciones y orientarse en las solicitudes hasta comprender la ayuda económica y los costos, con orientación en inglés y español.')}</p>
    <p>{t('Founded by a first-generation college graduate, Origen began with hands-on support for students navigating college admissions, including students who were accepted to UC Irvine and UC Riverside. That experience revealed a broader need: students and families benefit from continued guidance throughout the college-planning process.','Fundado por una persona graduada de la universidad de primera generación, Origen comenzó brindando apoyo directo a estudiantes durante el proceso de admisión universitaria, incluidos estudiantes que fueron aceptados en UC Irvine y UC Riverside. Esa experiencia reveló una necesidad más amplia: estudiantes y familias se benefician de una orientación continua durante todo el proceso de planificación universitaria.')}</p>
    <p>{t('Through financial-aid work and student outreach, we’ve seen how much information families receive—and how many questions remain after an event or conversation ends. For many English- and Spanish-speaking families, this is their first time navigating college, and a single conversation is only the beginning.','A través del trabajo en ayuda económica y orientación estudiantil, hemos visto cuánta información reciben las familias y cuántas preguntas quedan después de un evento o una conversación. Para muchas familias que hablan inglés o español, es la primera vez que se orientan en el proceso universitario, y una sola conversación es apenas el comienzo.')}</p>
    <p>{t('Origen grew from that work into a resource where students and families can continue guided research at their own pace. They can revisit explanations, explore official resources, and ask new questions as they learn.','Origen creció a partir de ese trabajo hasta convertirse en un recurso donde estudiantes y familias pueden continuar investigando con orientación y a su propio ritmo. Pueden volver a las explicaciones, explorar recursos oficiales y hacer nuevas preguntas mientras aprenden.')}</p>
    <p>{t('Our purpose is to help students and families stay informed, involved, and confident in their next steps, alongside the support available through schools, colleges, and student services.','Nuestro propósito es ayudar a estudiantes y familias a mantenerse informados, involucrados y seguros de sus próximos pasos, junto con el apoyo disponible en escuelas, universidades y servicios estudiantiles.')}</p>
   </section>
   <LandingDetails t={t}/>
   <section className="landing-closing"><h2>{t('You belong in this conversation.','Tu voz tiene un lugar aquí.')}</h2><button onClick={()=>setLogin(true)}>{t('Let’s get started','Empecemos')}<ArrowRight size={18}/></button></section>
  </main>
  <footer className="landing-footer"><strong>origen.</strong><a href="#institutions">{t('Register your institution','Registra tu institución')}</a>{publicContactEmail&&<a href="#contact">{t('Contact','Contacto')}</a>}<a href="#privacy">{t('Privacy','Privacidad')}</a><span>{t('A path forward, together.','Un camino adelante, juntos.')}</span><button onClick={enter}>{t('Explore the preview','Explorar la vista previa')}<ArrowUpRight size={14}/></button></footer>
  <dialog ref={dialog} className="landing-dialog" aria-labelledby="landing-signin-title" onCancel={()=>setLogin(false)}><button className="dialog-close" aria-label={t('Close','Cerrar')} onClick={()=>setLogin(false)}><X size={22}/></button><span className="landing-eyebrow">{t('WELCOME TO ORIGEN','BIENVENIDO A ORIGEN')}</span><h2 id="landing-signin-title">{t('Your path starts here.','Tu camino empieza aquí.')}</h2><p>{t('One simple step to create an account or come back to your family.','Un paso sencillo para crear una cuenta o volver a tu familia.')}</p><p>{t('Continue to secure phone sign-in. Enter your number there and verify the code sent by text.','Continúa al acceso seguro por teléfono. Ingresa tu número allí y verifica el código enviado por texto.')}</p><button className="landing-primary" disabled={isLoading} onClick={signIn}>{t('Continue with phone number','Continuar con número de teléfono')}<ArrowRight size={18}/></button>{(signinError||error)&&<p role="alert">{t('Could not complete sign-in. Please try again.','No se pudo completar el acceso. Intenta de nuevo.')}</p>}<p>{t('The preview uses a sample family. AI guidance requires sign-in.','La vista previa usa una familia de ejemplo. La orientación de IA requiere iniciar sesión.')}</p><button className="landing-preview-link" onClick={enter}>{t('Explore Origen without signing in','Explorar Origen sin iniciar sesión')}<ArrowRight size={17}/></button></dialog>
 </div>;
}
