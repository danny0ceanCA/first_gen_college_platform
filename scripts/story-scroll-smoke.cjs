const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {chromium}=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json')('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
  const profiler=await page.context().newCDPSession(page);
  await profiler.send('Performance.enable');
  if(process.env.ORIGEN_SCROLL_CPU_RATE)await profiler.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.ORIGEN_SCROLL_CPU_RATE)});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5188/');
  await page.locator('.story-stroke').first().waitFor({state:'attached'});
  await page.waitForTimeout(500);
  const before=(await profiler.send('Performance.getMetrics')).metrics;
  const result=await page.evaluate(async(bursts)=>{
   const story=document.querySelector('#story'),stage=story.querySelector('.story-stage');
   const top=story.getBoundingClientRect().top+scrollY,travel=story.offsetHeight-stage.offsetHeight;
   scrollTo(0,top);await new Promise(resolve=>setTimeout(resolve,400));
   let geometryReads=0,pointReads=0,treeChanges=0,overlappingChapters=false;const original=SVGGraphicsElement.prototype.getScreenCTM;
   const originalPoint=SVGGeometryElement.prototype.getPointAtLength;
   SVGGeometryElement.prototype.getPointAtLength=function(...args){pointReads++;return originalPoint.apply(this,args);};
   const observer=new MutationObserver(records=>{treeChanges+=records.length;});observer.observe(stage,{childList:true,subtree:true});
   SVGGraphicsElement.prototype.getScreenCTM=function(){geometryReads++;return original.call(this);};
   const frames=[];let previous=performance.now();
   for(let i=0;i<180;i++){
    await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;
    const step=bursts?Math.min(179,Math.floor(i/8)*8):i;
    scrollTo(0,top+travel*step/179);
    if([...story.querySelectorAll('.story-chapter')].filter(chapter=>Number(chapter.style.opacity)>.01).length>1)overlappingChapters=true;
   }
   scrollTo(0,top+travel);await new Promise(resolve=>setTimeout(resolve,700));
   const complete=[...story.querySelectorAll('.story-stroke')].every(path=>Number(path.style.strokeDashoffset)<.1);
   scrollTo(0,top);await new Promise(resolve=>setTimeout(resolve,700));
   const reversed=[...story.querySelectorAll('.story-chapter-3 .story-stroke')].every(path=>Number(path.style.strokeDashoffset)>0);
   SVGGraphicsElement.prototype.getScreenCTM=original;
   SVGGeometryElement.prototype.getPointAtLength=originalPoint;observer.disconnect();
   frames.sort((a,b)=>a-b);
   return {geometryReads,pointReads,treeChanges,overlappingChapters,p95FrameMs:Math.round(frames[Math.floor(frames.length*.95)]*10)/10,longFrames:frames.filter(ms=>ms>34).length,complete,reversed,overflow:document.documentElement.scrollWidth>innerWidth};
  },process.env.ORIGEN_SCROLL_BURSTS==='1');
  assert.deepEqual(errors,[]);assert.equal(result.complete,true);assert.equal(result.reversed,true);assert.equal(result.overflow,false);
  if(process.env.ORIGEN_SCROLL_OPTIMIZED){assert.equal(result.geometryReads,0,'scroll frames must not force SVG geometry reads');assert.equal(result.pointReads,0,'the pen must not measure curves during scrolling');assert.equal(result.treeChanges,0,'scrolling must not rebuild SVG layers');assert.equal(result.overlappingChapters,false,'chapter text must not overlap');}
  const after=(await profiler.send('Performance.getMetrics')).metrics;
  const duration=name=>Math.round(((after.find(m=>m.name===name)?.value||0)-(before.find(m=>m.name===name)?.value||0))*1000);
  console.log(JSON.stringify({width,...result,mainThreadMs:duration('TaskDuration'),styleMs:duration('RecalcStyleDuration')}));await page.close();
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
