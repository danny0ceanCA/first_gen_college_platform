import {useEffect,useRef,useState} from 'react';
import {animate} from 'animejs';
import {ArrowRight,ArrowUpRight,BookOpen,Mic,Users,X} from 'lucide-react';
import './Landing.css';
export default function Landing({enter}:{enter:()=>void}){
 const [es,setEs]=useState(false),[login,setLogin]=useState(false),[replay,setReplay]=useState(0),[paused,setPaused]=useState(false);
 const motion=useRef<ReturnType<typeof animate>[]>([]),pauseRef=useRef(false);
 const line=useRef<SVGSVGElement>(null),ambient=useRef<SVGSVGElement>(null),sky=useRef<SVGSVGElement>(null),dialog=useRef<HTMLDialogElement>(null);
 const t=(en:string,sp:string)=>es?sp:en;
 useEffect(()=>{document.documentElement.lang=es?'es':'en';},[es]);
 useEffect(()=>{
  if(!line.current||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const scene=line.current;
  const animations:ReturnType<typeof animate>[]=[];
  const originals=Array.from(scene.querySelectorAll<SVGPathElement>('path:not(.sky-drift)'));
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
   animations.push(animate(phase,{value:[0,Math.PI*2],duration:16000+index*2700,loop:true,ease:'linear',onUpdate:()=>{
    const wave=phase.value+index*1.7;
    cloud.setAttribute('transform',`translate(${Math.sin(wave)*22} ${Math.cos(wave)*3})`);
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
  motion.current=animations;
  if(pauseRef.current)animations.forEach(a=>a.pause());
  return ()=>{animations.forEach(animation=>animation.revert());fragments.forEach(path=>path.remove());originals.forEach(path=>path.style.removeProperty('visibility'));motion.current=[];};
 },[replay]);
 useEffect(()=>{
  pauseRef.current=paused;
  motion.current.forEach(animation=>paused?animation.pause():animation.play());
 },[paused]);
 useEffect(()=>{if(login)dialog.current?.showModal();else dialog.current?.close();},[login]);
 return <div className="landing">
  <header className="landing-nav"><a className="landing-logo" href="#" aria-label="Camino"><span className="landing-mark">∩</span>camino<span>.</span></a><nav aria-label={t('Navigation','Navegación')}><a href="#how">{t('How it works','Cómo funciona')}</a><button onClick={()=>setEs(!es)}>{es?'English':'Español'}</button><button className="landing-login" onClick={()=>setLogin(true)}>{t('Sign in','Ingresar')}<ArrowUpRight size={16}/></button></nav></header>
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
    <div className="landing-copy"><div className="landing-eyebrow"><span/> {t('A PATH FORWARD, TOGETHER','UN CAMINO ADELANTE, JUNTOS')}</div><h1>{t('Their next chapter.','Su próximo capítulo.')}<br/><em>{t('Your journey, too.','También es tu camino.')}</em></h1><p>{t('College comes with big questions. Find a little clarity, understand the costs, and take the next step—with someone by your side.','La universidad trae grandes preguntas. Encuentra claridad, entiende los costos y da el siguiente paso con alguien a tu lado.')}</p><button className="landing-primary" onClick={()=>setLogin(true)}>{t('Find your way forward','Encuentra tu camino')}<ArrowRight size={19}/></button><div className="landing-caption">{t('For students. For families. En español también.','Para estudiantes. Para familias. También en inglés.')}</div></div>
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
      <circle className="drawing-tip drawing-tip-0" r="3" opacity="0" strokeWidth="0.9"/>
      <circle className="drawing-tip drawing-tip-1" r="3" opacity="0" strokeWidth="0.9"/>
     </svg>
     <div className="scene-caption"><span>{t('MANY PATHS. ONE COMMUNITY.','MUCHOS CAMINOS. UNA COMUNIDAD.')}</span><div><button className="motion-toggle" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?t('Play','Reproducir'):t('Pause','Pausar')}</button><button className="path-replay" onClick={()=>setReplay(n=>n+1)}>{t('Replay ↗','Repetir ↗')}</button></div></div>
    </div>
   </section>
   <section className="landing-intro" id="how"><div><span className="landing-eyebrow">{t('YOU DON’T NEED ALL THE ANSWERS','NO NECESITAS SABERLO TODO')}</span><h2>{t('Just a place to begin.','Solo un lugar para empezar.')}</h2></div><p>{t('Whether college is familiar or completely new to your family, Camino helps make the unfamiliar feel manageable. One question at a time.','La universidad puede ser conocida o completamente nueva para tu familia. Camino te ayuda a entenderla, una pregunta a la vez.')}</p></section>
   <section className="landing-steps" aria-label={t('Ways Camino helps','Cómo ayuda Camino')}>
    {[{icon:Users,n:'01',title:t('Start with your student','Empieza con tu estudiante'),text:t('Keep their interests, goals and college choices in one place. Every student has a different story.','Reúne sus intereses, metas y opciones universitarias. Cada estudiante tiene su propia historia.')},{icon:Mic,n:'02',title:t('Talk it through','Hablemos de tus preguntas'),text:t('Ask about college costs out loud. Get plain-language guidance and links to official sources.','Pregunta en voz alta sobre los costos. Recibe explicaciones claras y enlaces a fuentes oficiales.')},{icon:BookOpen,n:'03',title:t('Take the next step','Da el siguiente paso'),text:t('Understand your options and find the official application for the colleges you’re considering.','Conoce tus opciones y encuentra la solicitud oficial de las universidades que te interesan.')}].map(({icon:Icon,n,title,text})=><article key={n}><div className="step-top"><Icon size={23}/><span>{n}</span></div><h3>{title}</h3><p>{text}</p></article>)}
   </section>
   <section className="landing-closing"><h2>{t('You belong in this conversation.','Tu voz tiene un lugar aquí.')}</h2><button onClick={()=>setLogin(true)}>{t('Let’s get started','Empecemos')}<ArrowRight size={18}/></button></section>
  </main>
  <footer className="landing-footer"><strong>camino.</strong><span>{t('A path forward, together.','Un camino adelante, juntos.')}</span><button onClick={enter}>{t('Explore the preview','Explorar la vista previa')}<ArrowUpRight size={14}/></button></footer>
  <dialog ref={dialog} className="landing-dialog" aria-labelledby="landing-signin-title" onCancel={()=>setLogin(false)}><button className="dialog-close" aria-label={t('Close','Cerrar')} onClick={()=>setLogin(false)}><X size={22}/></button><span className="landing-eyebrow">{t('WELCOME TO CAMINO','BIENVENIDO A CAMINO')}</span><h2 id="landing-signin-title">{t('Your path starts here.','Tu camino empieza aquí.')}</h2><p>{t('One simple step to create an account or come back to your family.','Un paso sencillo para crear una cuenta o volver a tu familia.')}</p><label>{t('Phone number','Número de teléfono')}<input type="tel" autoComplete="tel" placeholder="(555) 123-4567"/></label><button className="landing-primary" disabled>{t('Text me a code','Enviar código por texto')}<ArrowRight size={18}/></button><p className="login-preview-note">{t('Sign-in design preview. Text codes and account creation aren’t connected yet.','Vista previa del diseño. Los códigos y la creación de cuentas aún no están conectados.')}</p><button className="landing-preview-link" onClick={enter}>{t('Explore Camino without signing in','Explorar Camino sin iniciar sesión')}<ArrowRight size={17}/></button></dialog>
 </div>;
}
