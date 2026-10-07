// Narrow browser smoke checks, not a WCAG conformance audit.
const {createRequire}=require('node:module');
const {mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ORIGEN_BROWSER_CHANNEL?{channel:process.env.ORIGEN_BROWSER_CHANNEL}:{})});const results=[];
 try{
  const page=await browser.newPage({reducedMotion:'reduce'});
  await page.route('**/api/institutions/published/**',r=>r.fulfill({json:{page:{name:'Example College',website:'https://example.edu',description:'Synthetic accessibility fixture.',programs:'Programs',admissions:'Admissions',financialAid:'Aid',events:'Visits',publicEmail:'',links:[{title:'Admissions information',url:'https://example.edu/apply'}]}}}));
  await page.route('**/api/institution-metrics/event',r=>r.fulfill({json:{ok:true}}));
  for(const width of [1280,375]){
   await page.setViewportSize({width,height:900});
   for(const route of ['#institutions','#institution/example']){
    await page.goto('about:blank');
    await page.goto((process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5176/')+route);
    await page.locator('main h1').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.keyboard.press('Tab');assert.match(await page.locator(':focus').innerText(),/Skip to content/);
    await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').evaluate(el=>el.tagName),'MAIN');
    const report=await page.evaluate(()=>({mainCount:document.querySelectorAll('main').length,overflow:document.documentElement.scrollWidth>innerWidth+1,unnamedButtons:[...document.querySelectorAll('button')].filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).length}));
    assert.equal(report.mainCount,1);assert.equal(report.overflow,false);assert.equal(report.unnamedButtons,0);
    await page.getByRole('button',{name:'Español',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'es');
    results.push({route,width,...report,languageSwitch:'passed',keyboardSkip:'passed'});
   }
  }
  mkdirSync('artifacts/vendor-readiness',{recursive:true});writeFileSync('artifacts/vendor-readiness/accessibility-smoke.json',JSON.stringify({date:new Date().toISOString(),method:'Playwright Chromium; synthetic public page; reduced motion; no authenticated staff/voice/native testing',results},null,2));
  await page.screenshot({path:'artifacts/vendor-readiness/institution-mobile.png',fullPage:true});console.log(JSON.stringify(results));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
