const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire((process.env.ORIGEN_BROWSER_MODULE_ROOT||process.cwd())+'/package.json')('playwright');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173';
const posterOnly=process.env.ORIGEN_VIDEO_POSTER_ONLY==='1';
const videos=[
 {variant:'onboarding',file:'origen-onboarding.mp4',en:'Getting started with Origen',es:'Primeros pasos con Origen',duration:180.466667},
 {variant:'college-costs',file:'origen-college-costs.mp4',en:'College costs with Origen',es:'Costos universitarios con Origen',duration:184.9},
 {variant:'binder',file:'origen-binder-preview.mp4',en:'Your Origen binder',es:'Tu carpeta de Origen',duration:82.5}
];
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a loopback preview');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined});
 try{
  for(const width of [1440,1024,768,390,320])for(const language of ['en','es']){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),requests=[],errors=[];
   try{
    await page.addInitScript(value=>localStorage.setItem('origen.language',value),language);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('.mp4'))requests.push(request);});
    await page.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(posterOnly&&url.pathname.endsWith('.mp4'))return route.fulfill({status:503,body:''});
     if(url.origin===new URL(origin).origin||['data:','blob:','about:'].includes(url.protocol))return route.continue();
     return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    });
    await page.goto(origin+'/#college-guidance',{waitUntil:'networkidle'});
    const cards=page.locator('#college-guidance .landing-video');
    assert.equal(await cards.count(),3,'three independent video cards');
    assert.equal(await page.locator('#how .landing-video').count(),0,'no duplicate in how it works');
    assert.equal(await page.locator('.landing-conversation-row').count(),3,'three content/video rows');
    assert.equal(await page.locator('.landing-video-placeholder').count(),0,'all three approved videos replace the placeholders');
    assert.equal(await page.locator('.landing-video-placeholder button,.landing-video-placeholder a,.landing-video-placeholder video,.landing-video-placeholder source').count(),0,'placeholder is noninteractive');
    assert.equal(await cards.locator('video,source').count(),0,'no players or sources before activation');
    assert.equal(requests.length,0,'no video requests before activation');
    const ids=await cards.locator('[id]').evaluateAll(elements=>elements.map(element=>element.id));
    assert.equal(new Set(ids).size,ids.length,'player accessibility IDs are unique');
    for(const row of await page.locator('.landing-conversation-row').all()){
     const copy=await row.locator('.landing-conversation-copy').boundingBox();
     const media=await row.locator('.landing-video,.landing-video-placeholder').boundingBox();
     assert.ok(media.x>=0&&media.x+media.width<=width+1&&media.width<=440,'every media space fits viewport');
     if(width>=1024){
      assert.equal(Math.round(media.width),440);
      assert.ok(copy.x+copy.width<=media.x,'desktop copy and media sit side by side');
     }else assert.ok(copy.y+copy.height<=media.y,'tablet/mobile media follows its copy');
    }
    for(const expected of videos){
     const selector=`.landing-video[data-video="${expected.variant}"] video`;
     const card=page.locator(`.landing-video[data-video="${expected.variant}"]`),poster=card.getByRole('button');
     await card.scrollIntoViewIfNeeded();
     assert.equal(await card.locator('video,source').count(),0,'each card loads only when activated');
     assert.equal(requests.filter(request=>new URL(request.url()).pathname.endsWith(expected.file)).length,0,'unactivated media is not fetched');
     assert.equal(await card.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),true,'poster loads');
     assert.equal(await card.getByRole('heading').textContent(),expected[language]);
     await poster.focus();await page.keyboard.press('Enter');
     const player=card.locator('video');
     if(posterOnly){
      await card.getByRole('alert').waitFor();
      assert.equal(await player.evaluate(video=>document.activeElement===video&&video.controls&&video.playsInline&&!video.autoplay),true);
      assert.equal(await card.getByRole('link').count(),1);
      console.log(JSON.stringify({width,language,variant:expected.variant,requestsBeforeActivation:0,errorRecovery:true,mode:'poster-only; actual playback not tested'}));
      continue;
     }
     await page.waitForFunction(selector=>{const v=document.querySelector(selector);return v&&v.currentTime>0&&!v.paused;},selector);
     const state=await player.evaluate(video=>({controls:video.controls,inline:video.playsInline,autoplay:video.autoplay,focused:document.activeElement===video,duration:video.duration}));
     assert.ok(state.controls&&state.inline&&state.focused);
     assert.equal(state.autoplay,false);
     assert.ok(Math.abs(state.duration-expected.duration)<2,'approved media duration matches');
     await page.keyboard.press('Space');
     await page.waitForFunction(selector=>document.querySelector(selector).paused,selector);
     await player.evaluate(video=>{video.currentTime=30;});
     await page.waitForFunction(selector=>{const v=document.querySelector(selector);return !v.seeking&&v.currentTime>=30&&v.readyState>=2;},selector);
     assert.equal(await player.evaluate(video=>video.error),null);
     console.log(JSON.stringify({width,language,variant:expected.variant,requestsBeforeActivation:0,...state}));
    }
    assert.deepEqual(errors,[]);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
