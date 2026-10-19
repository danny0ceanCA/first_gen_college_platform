const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {chromium}=createRequire((process.env.ORIGEN_BROWSER_MODULE_ROOT||process.cwd())+'/package.json')('playwright');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173';
const posterOnly=process.env.ORIGEN_VIDEO_POSTER_ONLY==='1';
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
    const card=page.locator('.landing-video'),poster=card.getByRole('button');
    assert.equal(await card.count(),1,'one video card on the page');
    assert.equal(await page.locator('#college-guidance .landing-video').count(),1,'video belongs to the conversation section');
    assert.equal(await page.locator('#how .landing-video').count(),0,'no duplicate in how it works');
    assert.equal(await page.locator('.landing-conversation-row').count(),3,'three content/video rows');
    assert.equal(await page.locator('.landing-video-placeholder').count(),2,'two forthcoming video spaces');
    assert.equal(await page.locator('.landing-video-placeholder button,.landing-video-placeholder a,.landing-video-placeholder video,.landing-video-placeholder source').count(),0,'placeholders are noninteractive and do not load media');
    await card.scrollIntoViewIfNeeded();
    assert.equal(await card.locator('video,source').count(),0,'no player or source before activation');
    assert.equal(requests.length,0,'video must not be fetched before activation');
    assert.equal(await card.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),true,'poster loads');
    assert.equal(await card.getByRole('heading').textContent(),language==='es'?'Primeros pasos con Origen':'Getting started with Origen');
    const bounds=await card.boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'card fits viewport');
    assert.ok(bounds.width<=440,'compact card is at most 440px');
    for(const row of await page.locator('.landing-conversation-row').all()){
     const copy=await row.locator('.landing-conversation-copy').boundingBox();
     const media=await row.locator('.landing-video,.landing-video-placeholder').boundingBox();
     assert.ok(media.x>=0&&media.x+media.width<=width+1&&media.width<=440,'every media space fits viewport');
     if(width>=1024){
      assert.equal(Math.round(media.width),440);
      assert.ok(copy.x+copy.width<=media.x,'desktop copy and media sit side by side');
     }else{
      assert.ok(copy.y+copy.height<=media.y,'tablet/mobile media follows its copy');
     }
    }
    await poster.focus();await page.keyboard.press('Enter');
    const player=card.locator('video');
    if(posterOnly){
     await card.getByRole('alert').waitFor();
     assert.equal(await player.evaluate(video=>document.activeElement===video&&video.controls&&video.playsInline&&!video.autoplay),true);
     assert.equal(await card.getByRole('link').count(),1);
     assert.deepEqual(errors,[]);
     console.log(JSON.stringify({width,language,cardWidth:bounds.width,requestsBeforeActivation:0,errorRecovery:true,mode:'poster-only; actual playback not tested'}));
     continue;
    }
    await page.waitForFunction(()=>{const v=document.querySelector('.landing-video video');return v&&v.currentTime>0&&!v.paused;});
    const state=await player.evaluate(video=>({controls:video.controls,inline:video.playsInline,autoplay:video.autoplay,focused:document.activeElement===video,duration:video.duration,fullscreen:typeof video.requestFullscreen==='function'}));
    assert.ok(requests.length>0,'activation fetches video');
    assert.ok(state.controls&&state.inline&&state.focused&&state.fullscreen);
    assert.equal(state.autoplay,false,'no automatic playback attribute');
    assert.ok(state.duration>150&&state.duration<210,'approved video is about three minutes');
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>document.querySelector('.landing-video video').paused);
    await player.evaluate(video=>{video.currentTime=30;});
    await page.waitForFunction(()=>{const v=document.querySelector('.landing-video video');return !v.seeking&&v.currentTime>=30&&v.readyState>=2;});
    assert.equal(await player.evaluate(video=>video.error),null);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,language,cardWidth:bounds.width,videoRequests:requests.length,...state}));
   }finally{await page.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
