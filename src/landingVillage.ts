type Route={getTotalLength:()=>number;getPointAtLength:(distance:number)=>{x:number;y:number}};

// The first paint and the running animation share the same routes and poses.
// Native geometry is enough to place the first frame; caching stays deferred.
export function readVillageActors(scene:SVGSVGElement,prepare:(path:SVGPathElement)=>Route=path=>path){
 const route=(index:number,leg:'route'|'exit')=>prepare(scene.querySelector<SVGPathElement>(`.life-${leg}-${index}`)!);
 const residents=Array.from(scene.querySelectorAll<SVGGElement>('.village-resident')).map((visitor,order)=>{
  const index=Number(visitor.dataset.route),arrival=route(index,'route'),departure=route(index,'exit');
  return {visitor,index,order,arrival,departure,arrivalLength:arrival.getTotalLength(),departureLength:departure.getTotalLength(),
   legs:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),arms:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-arm'))};
 });
 const animals=Array.from(scene.querySelectorAll<SVGGElement>('.village-animal')).map(visitor=>{
  const index=Number(visitor.dataset.route),outward=route(index,'route'),homeward=route(index,'exit');
  return {visitor,index,burro:visitor.dataset.kind==='burro',bull:visitor.dataset.kind==='bull',outward,homeward,outwardLength:outward.getTotalLength(),homewardLength:homeward.getTotalLength(),
   legs:Array.from(visitor.querySelectorAll<SVGPathElement>('.walking-leg')),head:visitor.querySelector<SVGGElement>('.grazing-head'),tail:visitor.querySelector<SVGPathElement>('.animal-tail')};
 });
 return {residents,animals};
}
type Actors=ReturnType<typeof readVillageActors>;

export function paintVillageResidents(residents:Actors['residents'],time:number){
 residents.forEach(({visitor,index,order,arrival,departure,arrivalLength,departureLength,legs,arms})=>{
  const gathering=index===0||index===8?0:index===1||index===5?1:null;
  const phase=(time+(gathering===null?0.42+order*0.11:gathering*0.32))%1;
  const chatting=gathering!==null&&phase>=0.22&&phase<0.44;
  const travelled=gathering!==null
   ?phase<0.22?arrivalLength*phase/0.22:phase<0.44?arrivalLength:arrivalLength+departureLength*Math.min(1,(phase-0.44)/0.28)
   :(arrivalLength+departureLength)*Math.min(1,phase/0.72);
  const leaving=travelled>=arrivalLength,route=leaving?departure:arrival,length=leaving?departureLength:arrivalLength;
  const distance=leaving?travelled-arrivalLength:travelled,point=route.getPointAtLength(distance);
  const next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
  const resting=phase>=0.72,facing=chatting?(index===0||index===1?1:-1):next.x<previous.x?-1:1,stride=chatting||resting?0:Math.sin(travelled*0.46);
  const scale=index===4?0.63:gathering!==null?0.78:index>=6?0.84:0.78;
  visitor.dataset.activity=chatting?'chatting':resting?'resting':'walking';visitor.style.opacity='0.9';
  visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
  legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1);leg.setAttribute('d',`M0 -10 L${swing*3} -5 L${swing*5} 0`);});
  arms.forEach((arm,i)=>{const swing=chatting?Math.sin(phase*Math.PI*36+i)*0.55+0.7:stride*(i?1:-1);arm.setAttribute('d',`M0 -18 L${swing*3} -14 L${swing*5} -12`);});
 });
}

export function paintVillageAnimal({visitor,burro,bull,outward,homeward,outwardLength,homewardLength,legs,head,tail}:Actors['animals'][number],time:number){
 const back=time>=0.5,progress=back?(time-0.5)*2:time*2,route=back?homeward:outward,length=back?homewardLength:outwardLength,distance=length*progress;
 const point=route.getPointAtLength(distance),next=route.getPointAtLength(Math.min(length,distance+1)),previous=route.getPointAtLength(Math.max(0,distance-1));
 const facing=next.x<previous.x?-1:1,stride=Math.sin((distance+(back?outwardLength:0))*0.44),scale=bull?0.94:burro?0.78:0.72;
 visitor.dataset.activity='walking';visitor.style.opacity='0.9';
 visitor.setAttribute('transform',`translate(${point.x} ${point.y-Math.abs(stride)*0.45}) scale(${facing*scale} ${scale})`);
 legs.forEach((leg,i)=>{const swing=stride*(i%2?1:-1),hip=bull?(i<2?-11:10):burro?(i<2?-9:10):(i<2?-6:7),top=bull?-12:burro?-11:-7;leg.setAttribute('d',`M${hip} ${top} L${hip+swing*2.5} -5 L${hip+swing*4} 0`);});
 head?.setAttribute('transform',`rotate(${10+Math.sin(time*Math.PI*16)*14} 12 -20)`);
 tail?.setAttribute('transform',`rotate(${Math.sin(time*Math.PI*24)*12} -17 -24)`);
}

export function cloudFrame(index:number,phase=0){
 const wave=phase+index*1.7;
 return {transform:`translate(${Math.sin(wave)*46} ${Math.cos(wave)*7})`,opacity:String(0.65+0.35*(Math.sin(wave)+1)/2)};
}
