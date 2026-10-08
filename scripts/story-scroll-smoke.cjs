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
   let geometryReads=0;const original=SVGGraphicsElement.prototype.getScreenCTM;
   SVGGraphicsElement.prototype.getScreenCTM=function(){geometryReads++;return original.call(this);};
   const frames=[];let previous=performance.now();
   for(let i=0;i<180;i++){
    await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;
    scrollTo(0,top+travel*i/179);
   }
   await new Promise(resolve=>setTimeout(resolve,500));
   const complete=[...story.querySelectorAll('.story-stroke')].every(path=>Number(path.style.strokeDashoffset)<.1);
   scrollTo(0,top);await new Promise(resolve=>setTimeout(resolve,700));
   const reversed=[...story.querySelectorAll('.story-chapter-3 .story-stroke')].every(path=>Number(path.style.strokeDashoffset)>0);
   SVGGraphicsElement.prototype.getScreenCTM=original;
   frames.sort((a,b)=>a-b);
   return {geometryReads,p95FrameMs:Math.round(frames[Math.floor(frames.length*.95)]*10)/10,complete,reversed,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.deepEqual(errors,[]);assert.equal(result.complete,true);assert.equal(result.reversed,true);assert.equal(result.overflow,false);
  if(process.env.ORIGEN_SCROLL_OPTIMIZED)assert.equal(result.geometryReads,0,'scroll frames must not force SVG geometry reads');
  console.log(JSON.stringify({width,...result}));await page.close();
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
