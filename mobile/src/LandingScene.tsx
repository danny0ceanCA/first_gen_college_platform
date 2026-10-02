import {useEffect,useState,type MutableRefObject} from 'react';
import {AccessibilityInfo,AppState,Pressable,StyleSheet,Text,View} from 'react-native';
import Svg,{Circle,G,Path} from 'react-native-svg';
import {svgPathProperties} from 'svg-path-properties';
import {scenePaths} from './scenePaths';

const sides=['left','right'] as const;
const strokes=sides.map(side=>{
 let offset=0;
 return scenePaths.filter(p=>p.side===side).map(p=>{
  const geometry=new svgPathProperties(p.d),length=geometry.getTotalLength(),start=offset;
  offset+=length;
  return {...p,geometry,length,start,end:offset};
 });
});
const visitors=[
 {kind:'lady',route:'M145 373 Q204 388 279 378',period:12500,offset:0},
 {kind:'farmer',route:'M540 363 Q487 378 422 375',period:14000,offset:2800},
 {kind:'person',route:'M45 386 Q108 405 190 397',period:13000,offset:5600},
 {kind:'person',route:'M638 390 Q585 402 515 395',period:14500,offset:8200},
 {kind:'farmer',route:'M319 549 C265 507 422 482 365 439 Q345 419 350 402',period:18000,offset:3600},
 {kind:'lady',route:'M350 555 C289 513 453 487 389 441 Q372 426 374 407',period:19000,offset:11000},
].map(v=>({...v,geometry:new svgPathProperties(v.route)}));
const duration=9500;
const sunOrbit='M352 69 A41 41 0 0 1 411 107 M407 124 A41 41 0 0 1 377 145';
export default function LandingScene({es,clockRef,enabled=true}:{es:boolean;clockRef:MutableRefObject<number>;enabled?:boolean}){
 const [time,setTime]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false),[replay,setReplay]=useState(0);
 useEffect(()=>{setTime(clockRef.current);},[clockRef]);
 useEffect(()=>{
  let mounted=true;
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReduced(value);});
  const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
  return ()=>{mounted=false;listener.remove();};
 },[]);
 useEffect(()=>{
  if(paused||reduced||!enabled)return;
  let last=Date.now(),elapsed=0,active=AppState.currentState!=='background'&&AppState.currentState!=='inactive',frame=0,lastPaint=0;
  const subscription=AppState.addEventListener('change',state=>{active=state==='active';last=Date.now();});
  const tick=()=>{
   const now=Date.now();if(active)elapsed+=Math.min(now-last,100);last=now;
   if(now-lastPaint>32){clockRef.current+=elapsed;setTime(clockRef.current);elapsed=0;lastPaint=now;}
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return ()=>{cancelAnimationFrame(frame);subscription.remove();};
 },[paused,reduced,replay,clockRef,enabled]);
 const progress=reduced?1:Math.min(time/duration,1),drift=reduced?0:Math.sin(time/2400)*38,glow=reduced?.75:.75+Math.sin(time/1300)*.2;
 return <View style={styles.wrap}><Svg viewBox="0 0 700 570" style={styles.scene} accessibilityLabel={es?'Dos líneas dibujan un pueblo entre montañas, con nubes en movimiento':'Two lines draw a village beneath mountains, with moving clouds'} accessible fill="none" stroke="#e0cfaf" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round">
 {strokes.map((side,index)=>{
  const total=side[side.length-1].end,distance=total*progress,current=side.find(p=>distance>=p.start&&distance<p.end);
  return <G key={index}>{side.map((p,i)=>{const drawn=Math.max(0,Math.min(p.length,distance-p.start));return drawn>0?<Path key={i} d={p.d} transform={p.d===sunOrbit&&!reduced?`rotate(${Math.max(0,time-duration)/18000*360} 370 105)`:undefined} strokeDasharray={[p.length+.1,p.length+.1]} strokeDashoffset={p.length-drawn}/>:null;})}{current&&progress<1&&<Circle {...(()=>{const point=current.geometry.getPointAtLength(distance-current.start);return {cx:point.x,cy:point.y};})()} r={2.8} fill="#f5e9d5" stroke="none"/>}</G>;
 })}
 <G transform={`translate(${drift} 0)`} opacity={glow}><Path d="M110 58 C146 44 192 64 227 50 C246 42 266 38 294 43" strokeWidth={5} opacity={.13}/><Path d="M110 58 C146 44 192 64 227 50 C246 42 266 38 294 43" strokeWidth={1.5}/></G>
 <G transform={`translate(${-drift*.85} 0)`} opacity={glow}><Path d="M437 62 C483 49 515 69 545 60 C565 54 585 55 605 61" strokeWidth={5} opacity={.13}/><Path d="M437 62 C483 49 515 69 545 60 C565 54 585 55 605 61" strokeWidth={1.5}/></G>
 {[{x:79,y:105},{x:605,y:96},{x:312,y:35}].map((p,i)=><Path key={i} d={`M${p.x-4} ${p.y} H${p.x+4} M${p.x} ${p.y-4} V${p.y+4}`} opacity={reduced?.65:.4+.5*(1+Math.sin(time/1700+i*2))/2}/>) }
 {progress===1&&!reduced&&<G strokeWidth={1.1}>
 {visitors.map((v,i)=>{const phase=((time-duration+v.offset)%v.period)/v.period,point=v.geometry.getPointAtLength(v.geometry.getTotalLength()*phase),step=Math.sin(time/170+i)*3,scale=i>3?.78+.22*phase:1;return <G key={i} transform={`translate(${point.x} ${point.y}) scale(${scale})`} opacity={Math.min(1,phase*12,(1-phase)*12)}><Circle cy={-23} r={3.2}/><Path d={`M0 -20 V-10 M0 -17 L${-4-step/2} -12 M0 -17 L${4+step/2} -12 M0 -10 L${-3-step} 0 M0 -10 L${3+step} 0`}/>{v.kind==='farmer'?<Path d="M-6 -26 H6 M-3 -26 V-29 H3 V-26"/>:v.kind==='lady'?<Path d="M0 -18 L-5 -7 H5 Z M-4 -25 Q0 -30 4 -25"/>:null}</G>;})}
 <G opacity={Math.min(1,((time-duration)%15500)/15500*12,(1-((time-duration)%15500)/15500)*12)} transform={`translate(${90+((time-duration)%15500)/15500*160} 384)`}><Path d="M-9 -15 H9 L12 -20 L18 -18 L17 -12 L9 -10 H-9 Z M-9 -14 L-14 -19 M12 -20 L12 -26 M15 -19 L17 -25"/><Path d={`M-7 -10 L${-7+Math.sin(time/210)*2} 0 M6 -10 L${6-Math.sin(time/210)*2} 0`}/></G>
 </G>}
 </Svg><View style={styles.controls}><Text style={styles.caption}>{es?'UN CAMINO, MUCHAS POSIBILIDADES':'ONE PATH, MANY POSSIBILITIES'}</Text>{!reduced&&<Pressable accessibilityRole="button" onPress={()=>setPaused(!paused)} style={styles.control}><Text style={styles.controlText}>{paused?(es?'Continuar':'Play'):(es?'Pausar':'Pause')}</Text></Pressable>}<Pressable accessibilityRole="button" onPress={()=>{clockRef.current=0;setTime(0);setPaused(false);setReplay(v=>v+1);}} style={styles.control}><Text style={styles.controlText}>{es?'Repetir':'Replay'}</Text></Pressable></View></View>;
}
const styles=StyleSheet.create({wrap:{width:'100%',maxWidth:520,alignSelf:'center',marginBottom:25},scene:{width:'100%',aspectRatio:700/570},controls:{flexDirection:'row',alignItems:'center',gap:12},caption:{flex:1,fontSize:7,letterSpacing:1,color:'#d5bd98'},control:{minHeight:44,justifyContent:'center',paddingHorizontal:5},controlText:{color:'#eadcc4',fontSize:11}});
