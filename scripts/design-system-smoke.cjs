// Local synthetic UI only: every API and external request is intercepted.
const {createRequire}=require('node:module'),assert=require('node:assert/strict'),{mkdir}=require('node:fs/promises');
const {chromium}=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json')('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/phase3-design-system',{recursive:true});
 try {for(const [width,motion] of [[1280,'no-preference'],[390,'no-preference'],[320,'reduce']]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:motion}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/api/')||u.origin!==origin)return route.fulfill({json:{}});
   return route.continue();
  });
  await page.route('**/design-system-preview',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {useDialogSurface} from '/src/useDialogSurface.ts';import {motionDuration} from '/src/motion.ts';
   import '/src/styles.css';import '/src/brand.css';import '/src/BinderSharing.css';
   const h=React.createElement;window.durations=()=>['control','section','exit','binder','ink'].map(motionDuration);
   function Surface({name,onDismiss,blocked,children}){const {ref,dismiss,dialogProps}=useDialogSurface({onDismiss,blocked});return h('dialog',{ref,...dialogProps,className:'binder-share-sheet','data-mobile-sheet':true,'aria-label':name},h('header',{className:'binder-share-sheet-heading'},h('h2',null,name),h('button',{'aria-label':'Close '+name,onClick:()=>void dismiss(),disabled:blocked},'×')),children);}
   function App(){const [open,setOpen]=React.useState(false),[nested,setNested]=React.useState(false),[busy,setBusy]=React.useState(false);window.clearAccess=()=>{setNested(false);setOpen(false)};return h('main',{style:{minHeight:1800,padding:24}},h('button',{className:'button primary',onClick:()=>setOpen(true)},'Share binder'),open&&h(Surface,{name:'Share your binder',onDismiss:()=>setOpen(false),blocked:busy},h('p',null,'Choose notes to share. Family conversations stay private.'),h('label',null,'Message',h('textarea',{'aria-label':'Message',defaultValue:'Please review my transfer plan.'})),h('button',{onClick:()=>setNested(true)},'Review notes'),h('button',{onClick:()=>setBusy(!busy)},busy?'Finish saving':'Simulate saving')),nested&&h(Surface,{name:'Review notes',onDismiss:()=>setNested(false)},h('p',null,'Only the selected transfer notes will be shared.'),h('button',null,'Share these notes')));}
   ReactDOM.createRoot(document.getElementById('root')).render(h(React.StrictMode,null,h(App)));
  </script></html>`}));
  try {
   await page.goto(origin+'/design-system-preview');
   const opener=page.getByRole('button',{name:'Share binder',exact:true});await opener.click();
   const sheet=page.getByRole('dialog',{name:'Share your binder',exact:true});await sheet.waitFor();
   await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
   assert.equal(await sheet.evaluate(el=>document.activeElement===el),true,'Dialog should focus its surface without a mobile keyboard');
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   assert.deepEqual(await page.evaluate(()=>window.durations()),motion==='reduce'?[0,0,0,0,0]:[150,240,120,440,760]);
   if(width<600){const b=await sheet.boundingBox();assert.ok(b.x<1&&b.y<1&&Math.abs(b.height-850)<1&&Math.abs(b.width-width)<1,'Mobile task must fill the screen');}
   for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert.ok(await sheet.evaluate(el=>el.contains(document.activeElement)),'Tab escaped the modal');}
   await page.getByRole('button',{name:'Review notes',exact:true}).click();
   await page.getByRole('dialog',{name:'Review notes',exact:true}).waitFor();
   await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Review notes',exact:true}).waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','Nested close released the parent scroll lock');
   assert.ok(await page.getByRole('button',{name:'Review notes',exact:true}).evaluate(el=>el===document.activeElement),'Nested close lost opener focus');
   await page.getByRole('button',{name:'Simulate saving'}).click();await page.keyboard.press('Escape');
   assert.equal(await sheet.count(),1,'Escape dismissed a pending save');await page.getByRole('button',{name:'Finish saving'}).click();
   await page.screenshot({path:'output/playwright/phase3-design-system/'+width+'-dialog.png'});
   await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
   assert.ok(await opener.evaluate(el=>el===document.activeElement),'Closing did not restore the opener');
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
   await opener.click();await sheet.waitFor();
   if(width>600){
    const b=await sheet.boundingBox();await page.mouse.move(b.x+25,b.y+25);await page.mouse.down();await page.mouse.move(2,2);await page.mouse.up();assert.equal(await sheet.count(),1,'Dragging out should not dismiss');
    await page.mouse.click(2,2);await sheet.waitFor({state:'detached'});await opener.click();await sheet.waitFor();
   }
   // Access loss is immediate, even during an entrance: never retain protected content to animate.
   await page.evaluate(()=>window.clearAccess());await sheet.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
   await opener.click();await sheet.waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
   assert.deepEqual(errors,[]);console.log(JSON.stringify({width,motion,result:'passed',checks:['focus trap/return','nested scroll lock','busy dismissal guard','mobile sheet','backdrop drag','access clearing','reduced motion']}));
  }catch(error){console.error({errors,body:(await page.locator('body').innerText()).slice(0,1000)});throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
