const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {chromium}=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json')('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5188/');
  await page.locator('.story-stroke').first().waitFor({state:'attached'});
  const result=await page.evaluate(async()=>{
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
    scrollTo(0,top+travel*i/179);
    if([...story.querySelectorAll('.story-chapter')].filter(chapter=>Number(chapter.style.opacity)>.01).length>1)overlappingChapters=true;
   }
   await new Promise(resolve=>setTimeout(resolve,500));
   const complete=[...story.querySelectorAll('.story-stroke')].every(path=>Number(path.style.strokeDashoffset)<.1);
   scrollTo(0,top);await new Promise(resolve=>setTimeout(resolve,700));
   const reversed=[...story.querySelectorAll('.story-chapter-3 .story-stroke')].every(path=>Number(path.style.strokeDashoffset)>0);
   SVGGraphicsElement.prototype.getScreenCTM=original;
   SVGGeometryElement.prototype.getPointAtLength=originalPoint;observer.disconnect();
   frames.sort((a,b)=>a-b);
   return {geometryReads,pointReads,treeChanges,overlappingChapters,p95FrameMs:Math.round(frames[Math.floor(frames.length*.95)]*10)/10,complete,reversed,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.deepEqual(errors,[]);assert.equal(result.complete,true);assert.equal(result.reversed,true);assert.equal(result.overflow,false);
  if(process.env.ORIGEN_SCROLL_OPTIMIZED){assert.equal(result.geometryReads,0,'scroll frames must not force SVG geometry reads');assert.equal(result.pointReads,0,'the pen must not measure curves during scrolling');assert.equal(result.treeChanges,0,'scrolling must not rebuild SVG layers');assert.equal(result.overlappingChapters,false,'chapter text must not overlap');}
  console.log(JSON.stringify({width,...result}));await page.close();
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
