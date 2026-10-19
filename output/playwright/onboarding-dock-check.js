// Run after onboarding-dock-preview.js and open the synthetic conversation.
async page=>{
 const results=[];
 for(const [width,height] of [[1897,909],[1280,900],[968,652],[761,652],[760,652],[600,800],[390,844],[320,640],[844,390]]){
  await page.setViewportSize({width,height});
  for(const [mode,label] of [['welcome','Voice onboarding'],['manual','Manual onboarding'],['home','Home']]){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.waitForFunction(mode=>{
    const selector=mode==='welcome'?'.welcome-conversation':mode==='manual'?'.welcome-panel':'.main-shell';
    const surface=document.querySelector(selector),bar=document.querySelector('.shared-voice');if(!surface||!bar)return false;
    const p=surface.getBoundingClientRect(),b=bar.getBoundingClientRect();return Math.abs(b.left-p.left)<1&&Math.abs(b.right-p.right)<1;
   },mode,{timeout:5000});
   const result=await page.evaluate(({mode,width,height})=>{
    const bar=document.querySelector('.shared-voice'),b=bar.getBoundingClientRect(),save=document.querySelector('.welcome-save-bar');
    const buttons=[...bar.querySelectorAll('button')].filter(n=>n.getBoundingClientRect().width);
    return {mode,width,height,left:b.left,right:b.right,bottom:b.bottom,barHeight:b.height,noHorizontalOverflow:bar.scrollWidth<=bar.clientWidth+1,controlsVisible:buttons.every(n=>{const r=n.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1;}),saveClear:!save||width>760||save.getBoundingClientRect().bottom<=b.top+1,reservedHeight:parseFloat(document.documentElement.style.getPropertyValue('--shared-voice-height'))};
   },{mode,width,height});
   if(!result.noHorizontalOverflow||!result.controlsVisible||!result.saveClear||Math.abs(result.reservedHeight-result.barHeight)>1||result.left<0||result.right>width+1||result.bottom>height+1)throw new Error('Voice dock layout failed: '+JSON.stringify(result));
   results.push(result);
  }
 }
 await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'Voice onboarding',exact:true}).click();
 await page.screenshot({path:'output/playwright/onboarding-dock-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/onboarding-dock-mobile.png'});
 return {cases:results.length,passed:true,results,pageErrors:(await page.pageErrors()).map(e=>e.message)};
}
