import {memo,useEffect,useMemo,useRef,useState} from 'react';
import {Animated,Platform,AccessibilityInfo,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import Svg,{Path,G} from 'react-native-svg';
import {svgPathProperties} from 'svg-path-properties';
import {storyArtwork} from './storyArtwork';
import {storyAccents} from './storyAccents';

const green='#a4513c',cream='#f4eee4';
const threadPath='M120 0 C120 70 24 65 24 180 C24 260 350 245 350 340 C350 430 26 440 26 525 C26 620 285 625 285 700';
const threadLength=new svgPathProperties(threadPath).getTotalLength();
const drawings=storyArtwork.map((paths,i)=>[
 {d:storyAccents[i].entry,detail:true,solid:false,rider:false},
 ...paths.map((p,j)=>({...p,rider:i===3&&j>=8})),
 ...storyAccents[i].details.map(d=>({d,detail:true,solid:false,rider:false})),
].map(p=>({...p,geometry:new svgPathProperties(p.d),length:new svgPathProperties(p.d).getTotalLength()})));
const title=[
 ['Their next chapter. Your support, every step.','Su próximo capítulo. Tu apoyo en cada paso.'],
 ['Bring your questions. We’ll talk them through.','Trae tus preguntas. Las conversamos juntos.'],
 ['See how the pieces fit together.','Entiende cómo se unen las piezas.'],
 ['A little guidance for the road ahead.','Un poco de orientación para el camino.'],
] as const;
const copy=[
 ['College may be new to your family. Keep your student’s interests and goals close, and find a place to begin together.','La universidad puede ser nueva para tu familia. Reúne los intereses y las metas de tu estudiante y encuentren juntos un lugar para empezar.'],
 ['Ask out loud, take your time, and ask again. Origen explains in everyday language—in English or Spanish.','Pregunta en voz alta, toma tu tiempo y vuelve a preguntar. Origen explica con palabras sencillas, en español o inglés.'],
 ['Start with tuition and fees. Understand financial aid, the FAFSA, and what your family may still need to cover.','Empieza con la matrícula y las cuotas. Entiende la ayuda económica, la FAFSA y lo que tu familia todavía podría necesitar cubrir.'],
 ['Understand your next step with UC, Cal State, Common App, and community college applications. Find the official portals and ask about anything unfamiliar.','Conoce tu próximo paso con las solicitudes de UC, Cal State, Common App y colegios comunitarios. Encuentra los portales oficiales y pregunta sobre lo que no conoces.'],
] as const;
function LandingStory({es,scrollPosition}:{es:boolean;scrollPosition:Animated.Value}){
 const {height,width}=useWindowDimensions();
 const [top,setTop]=useState(0),[reduced,setReduced]=useState(false);
 useEffect(()=>{let live=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(live)setReduced(v);});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{live=false;sub.remove();};},[]);
 const panelHeight=Math.max(520,height-110),travel=panelHeight*3.5,total=travel+panelHeight;
 const [position]=useState(()=>new Animated.Value(0));
 const [chapterPositions]=useState(()=>[0,1,2,3].map(()=>new Animated.Value(0)));
 const latestScroll=useRef(0);
 useEffect(()=>{
 if(reduced)return;
  let frame=0,lastFrame=0,current=Math.max(0,Math.min(1,(latestScroll.current-top)/travel))*3.65;
  let target=current;
  const previous:number[]=[];
  const paint=(value:number)=>{
   position.setValue(value);
   // Park offscreen illustration graphs; only the current chapter receives SVG updates.
   chapterPositions.forEach((chapter,i)=>{
    const next=Math.max(i-.2,Math.min(i+.98,value));
    if(previous[i]!==next){previous[i]=next;chapter.setValue(next);}
   });
  };
  const update=(time:number)=>{
   frame=0;
   const elapsed=lastFrame?Math.min(64,time-lastFrame):16.67;lastFrame=time;
   current+=(target-current)*(1-Math.exp(-elapsed/90));
   if(Math.abs(target-current)<.0005)current=target;
   paint(current);
   if(current!==target)frame=requestAnimationFrame(update);
  };
  paint(current);
  const listener=scrollPosition.addListener(({value})=>{
   latestScroll.current=value;
   target=Math.max(0,Math.min(1,(value-top)/travel))*3.65;
   if(current!==target&&!frame){lastFrame=0;frame=requestAnimationFrame(update);}
  });
  return()=>{scrollPosition.removeListener(listener);cancelAnimationFrame(frame);};
 },[scrollPosition,position,chapterPositions,top,travel,reduced]);
 const offset=useMemo(()=>scrollPosition.interpolate({inputRange:[top,top+travel],outputRange:[0,travel],extrapolate:'clamp'}),[scrollPosition,top,travel]);
 const fades=useMemo(()=>[0,1,2,3].map(i=>position.interpolate({inputRange:[i-.20,i-.02,i+.72,i+.98],outputRange:[i===0?1:0,1,1,i===3?1:0],extrapolate:'clamp'})),[position]);
  const threadDash=useMemo(()=>position.interpolate({inputRange:[0,3.65],outputRange:[threadLength,0],extrapolate:'clamp'}),[position]);
 const threadTip=useMemo(()=>position.interpolate({inputRange:[0,3.65],outputRange:[24,24-threadLength],extrapolate:'clamp'}),[position]);
 const scene=(i:number)=><Animated.View key={i} style={[styles.chapter,{minHeight:panelHeight,position:reduced?'relative':'absolute',top:0,left:0,right:0,opacity:reduced?1:fades[i]}]}><View style={[styles.art,{width:Math.min(width-36,440),height:Math.min(265,panelHeight*.43)}]}><StoryIllustration i={i} position={chapterPositions[i]} es={es} reduced={reduced}/></View><View style={styles.text}><Text style={styles.kicker}>{String(i+1).padStart(2,'0')} / {es?'UN CAMINO ADELANTE':'A PATH FORWARD'}</Text><Text style={[styles.title,width<360&&{fontSize:25,lineHeight:29}]}>{title[i][es?1:0]}</Text><Text style={[styles.body,width<360&&{fontSize:13,lineHeight:20}]}>{copy[i][es?1:0]}</Text><View style={styles.underline}/></View></Animated.View>;
 if(reduced)return <View onLayout={e=>setTop(e.nativeEvent.layout.y)}>{[0,1,2,3].map(scene)}</View>;
 const contents=<><View style={styles.thread} pointerEvents="none"><Svg viewBox="0 0 390 700" width="100%" height="100%" preserveAspectRatio="none"><Path d={threadPath} fill="none" stroke={cream} strokeWidth=".8" opacity=".08"/><AnimatedPath d={threadPath} fill="none" stroke={cream} strokeWidth="1" opacity=".42" strokeDasharray={[threadLength,threadLength]} strokeDashoffset={threadDash}/><AnimatedPath d={threadPath} fill="none" stroke={cream} strokeWidth="1.6" opacity=".9" strokeLinecap="round" strokeDasharray={[24,threadLength]} strokeDashoffset={threadTip}/></Svg></View>{[0,1,2,3].map(scene)}</>;
 return <View onLayout={e=>setTop(e.nativeEvent.layout.y)} style={{height:total}}>{Platform.OS==='web'
  // Browser stickiness follows scroll on the compositor, without JS counter-scrolling.
  ?<div style={{position:'sticky',top:0,height:panelHeight,width:'100%',overflow:'hidden'}}>{contents}</div>
  :<Animated.View style={[styles.pinned,{height:panelHeight,transform:[{translateY:offset}]}]}>{contents}</Animated.View>}</View>;
}
export default memo(LandingStory);

const AnimatedPath=Animated.createAnimatedComponent(Path);
const AnimatedGroup=Animated.createAnimatedComponent(G);
// Build SVGs once. Scroll changes their animated attributes, never the scene tree.
const StoryIllustration=memo(function StoryIllustration({i,position,es,reduced}:{i:number;position:Animated.Value;es:boolean;reduced:boolean}){
 const strokes=useMemo(()=>{
  const total=drawings[i].reduce((sum,path)=>sum+path.length,0);
  return drawings[i].map((path,j)=>{
   const previousLength=drawings[i].slice(0,j).reduce((sum,p)=>sum+p.length,0);
   const start=i-(i===0?0:.12)+previousLength/total*.23;
   const end=i-(i===0?0:.12)+(previousLength+path.length)/total*.23;
   return {path,dash:position.interpolate({inputRange:[start,end],outputRange:[path.length,0],extrapolate:'clamp'}),opacity:position.interpolate({inputRange:[start,start+Math.min(.0004,(end-start)/2)],outputRange:[0,path.detail?.7:1],extrapolate:'clamp'})};
  });
 },[i,position]);
 const rider=useMemo(()=>position.interpolate({inputRange:[3.18,3.65],outputRange:['matrix(1 0 0 1 -45 14)','matrix(0.65 0 0 0.65 125 139)'],extrapolate:'clamp'}),[position]);
 const ink=(j:number)=>{const {path,dash,opacity}=strokes[j];return <AnimatedPath key={j} d={path.d} fill={path.solid?green:'none'} strokeWidth={path.detail?.65:1.15} opacity={reduced?(path.detail?.7:1):opacity} strokeDasharray={[path.length+.2,path.length+.2]} strokeDashoffset={reduced?0:dash}/>;};
 const pen=useMemo(()=>{
  const paths=drawings[i];const total=paths.reduce((sum,p)=>sum+p.length,0);const base=i-(i===0?0:.12);
  const input:number[]=[],x:number[]=[],y:number[]=[];let distance=0;
  paths.forEach(path=>{
   const count=Math.max(2,Math.ceil(path.length/18));
   for(let step=0;step<count;step++){
    const fraction=step/count,point=path.geometry.getPointAtLength(path.length*fraction);
    input.push(base+(distance+path.length*fraction)/total*.23);
    x.push(point.x+(path.rider?-45:0));y.push(point.y+(path.rider?14:0));
   }
   distance+=path.length;
  });
  const end=paths[paths.length-1].geometry.getPointAtLength(paths[paths.length-1].length);
  input.push(base+.23);x.push(end.x);y.push(end.y);
  return {transform:position.interpolate({inputRange:input,outputRange:x.map((v,j)=>`translate(${v} ${y[j]})`),extrapolate:'clamp'}),opacity:position.interpolate({inputRange:[base,base+.004,base+.225,base+.23],outputRange:[0,1,1,0],extrapolate:'clamp'})};
 },[i,position]);
 return <Svg viewBox="0 0 560 480" width="100%" height="100%" stroke={cream} strokeLinecap="round" strokeLinejoin="round" fill="none" accessible accessibilityLabel={es?title[i][1]:title[i][0]}>{i===3?<>{strokes.map((s,j)=>!s.path.rider?ink(j):null)}<AnimatedGroup transform={reduced?'matrix(0.65 0 0 0.65 125 139)':rider}>{strokes.map((s,j)=>s.path.rider?ink(j):null)}</AnimatedGroup></>:strokes.map((_,j)=>ink(j))}{!reduced&&<AnimatedGroup transform={pen.transform} opacity={pen.opacity}><Path d="M-2 1 L2 -1" stroke="#fff1d5" strokeWidth={2.4}/></AnimatedGroup>}</Svg>;
});

const styles=StyleSheet.create({pinned:{position:'absolute',top:0,left:0,right:0,overflow:'hidden',justifyContent:'center'},thread:{position:'absolute',left:0,right:0,top:0,bottom:0},chapter:{justifyContent:'center',paddingHorizontal:20,paddingTop:14,paddingBottom:20},art:{height:265,alignSelf:'center'},text:{paddingHorizontal:12,marginTop:4},kicker:{fontSize:8,letterSpacing:1.9,color:'#c9ae80',fontWeight:'700'},title:{fontSize:29,lineHeight:34,letterSpacing:-1,color:cream,marginTop:13,marginBottom:12},body:{fontSize:14,lineHeight:22,color:'#f4eee4'},underline:{width:40,height:1,backgroundColor:'#f4eee47a',marginTop:20}});
