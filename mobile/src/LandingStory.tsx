import {useEffect,useState} from 'react';
import {Animated,AccessibilityInfo,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import Svg,{Path,G} from 'react-native-svg';
import {svgPathProperties} from 'svg-path-properties';
import {storyArtwork} from './storyArtwork';

const green='#254e42',cream='#eadcc4';
const drawings=storyArtwork.map(paths=>paths.map(p=>({...p,length:new svgPathProperties(p.d).getTotalLength()})));
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
export default function LandingStory({es,scrollY,scrollPosition}:{es:boolean;scrollY:number;scrollPosition:Animated.Value}){
 const {height,width}=useWindowDimensions();
 const [top,setTop]=useState(0),[reduced,setReduced]=useState(false);
 useEffect(()=>{let live=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(live)setReduced(v);});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{live=false;sub.remove();};},[]);
 const panelHeight=Math.max(520,height-110),travel=panelHeight*3.5,total=travel+panelHeight;
 const progress=Math.max(0,Math.min(1,(scrollY-top)/travel));
 const position=progress*3.65;
 const offset=scrollPosition.interpolate({inputRange:[top,top+travel],outputRange:[0,travel],extrapolate:'clamp'});
 const scene=(i:number,p:number)=><Animated.View key={i} style={[styles.chapter,{minHeight:panelHeight,position:reduced?'relative':'absolute',top:0,left:0,right:0,opacity:reduced?1:scrollPosition.interpolate({inputRange:[top+(i-.15)*travel/3.65,top+i*travel/3.65,top+(i+.70)*travel/3.65,top+(i+.85)*travel/3.65],outputRange:[i===0?1:0,1,1,i===3?1:0],extrapolate:'clamp'})}]}><View style={[styles.art,{width:Math.min(width-36,440),transform:[{translateX:reduced?0:(i%2===0?1:-1)*(p-.5)*20}]}]}><Svg viewBox="0 0 560 480" width="100%" height="100%" stroke={cream} strokeLinecap="round" strokeLinejoin="round" fill="none" accessible accessibilityLabel={es?title[i][1]:title[i][0]}>{drawings[i].map((path,j)=>{const reveal=reduced?1:Math.max(0,Math.min(1,p*3.8-j*.013));return reveal>0?<G key={j} transform={i===3&&j>=8?`translate(${Math.max(0,p-.18)*200} ${-Math.max(0,p-.18)*10}) translate(200 280) scale(${1-Math.max(0,p-.18)*.3}) translate(-200 -280)`:undefined}><Path d={path.d} fill={path.solid?green:'none'} strokeWidth={path.detail?.65:1.15} opacity={path.detail?.7:1} strokeDasharray={[path.length+.2,path.length+.2]} strokeDashoffset={path.length*(1-reveal)}/></G>:null;})}</Svg></View><View style={styles.text}><Text style={styles.kicker}>{String(i+1).padStart(2,'0')} / {es?'UN CAMINO ADELANTE':'A PATH FORWARD'}</Text><Text style={styles.title}>{title[i][es?1:0]}</Text><Text style={styles.body}>{copy[i][es?1:0]}</Text><View style={styles.underline}/></View></Animated.View>;
 if(reduced)return <View onLayout={e=>setTop(e.nativeEvent.layout.y)}>{[0,1,2,3].map(i=>scene(i,1))}</View>;
 return <View onLayout={e=>setTop(e.nativeEvent.layout.y)} style={{height:total}}><Animated.View style={[styles.pinned,{height:panelHeight,transform:[{translateY:offset}]}]}><View style={styles.thread} pointerEvents="none"><Svg viewBox="0 0 390 700" width="100%" height="100%" preserveAspectRatio="none"><Path d="M120 0 C120 70 24 65 24 180 C24 260 350 245 350 340 C350 430 26 440 26 525 C26 620 285 625 285 700" fill="none" stroke={cream} strokeWidth=".8" opacity=".38"/></Svg></View>{[0,1,2,3].map(i=>scene(i,Math.max(0,Math.min(1,position-i+.18))))}</Animated.View></View>;
}
const styles=StyleSheet.create({pinned:{position:'absolute',top:0,left:0,right:0,overflow:'hidden',justifyContent:'center'},thread:{position:'absolute',left:0,right:0,top:0,bottom:0},chapter:{justifyContent:'center',paddingHorizontal:20,paddingTop:14,paddingBottom:20},art:{height:265,alignSelf:'center'},text:{paddingHorizontal:12,marginTop:4},kicker:{fontSize:8,letterSpacing:1.9,color:'#c9ae80',fontWeight:'700'},title:{fontSize:29,lineHeight:34,letterSpacing:-1,color:cream,marginTop:13,marginBottom:12},body:{fontSize:14,lineHeight:22,color:'#d0c7b5'},underline:{width:40,height:1,backgroundColor:'#eadcc47a',marginTop:20}});
