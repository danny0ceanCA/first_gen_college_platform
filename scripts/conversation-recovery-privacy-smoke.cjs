// Separate local Chrome, synthetic identity and delayed response bodies only.
const {createRequire}=require('node:module'),assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup}=require('./student-memory-smoke.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const event of ['none','forget','logout','account-change']){
  const {page}=await setup(browser,{configurePage:async page=>page.setDefaultNavigationTimeout(30000)});
  try{
   const result=await page.evaluate(async event=>{
    const {recoveryRequest,recoveryChoice}=await import('/src/conversationRecovery.ts');
    const {browserPrivacy}=await import('/src/browserPrivacy.mjs');
    const original=window.fetch;let releaseBody,bodyRequested;
    const waiting=new Promise(resolve=>{bodyRequested=resolve;});
    window.fetch=async(input,options)=>String(input).includes('/api/conversation-recovery')?{ok:true,status:200,json:()=>new Promise(resolve=>{releaseBody=resolve;bodyRequested();})}:original(input,options);
    try{
     recoveryChoice.enabled=true;
     const pending=recoveryRequest({action:'read',id:'synthetic-late-copy'}).then(()=>({returned:true}),error=>({returned:false,name:error.name}));
     await waiting;
     if(event==='forget')browserPrivacy.forget({id:'synthetic-late-copy'});
     if(event==='logout')browserPrivacy.stop('logout');
     if(event==='account-change')browserPrivacy.start('different-synthetic-account',{fresh:true});
     releaseBody({body:{turns:[{role:'user',text:'Synthetic private discussion.'}]}});
     return {...await pending,choice:recoveryChoice.enabled};
    }finally{window.fetch=original;}
   },event);
   assert.equal(result.returned,event==='none');
   if(event!=='none')assert.equal(result.name,'AbortError');
   if(event==='forget')assert.equal(result.choice,true,'An erasure does not silently change the session consent checkbox.');
   console.log(`PASS delayed recovery body: ${event}`);
  }finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
