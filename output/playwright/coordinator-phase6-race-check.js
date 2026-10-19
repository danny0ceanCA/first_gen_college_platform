// Run after the preview has been switched to Coordinator view in English.
async page=>{
 await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
 const before=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,images:document.querySelectorAll('.guidance-body img').length,storage:JSON.stringify([localStorage,sessionStorage])}));
 if(before.overflow||before.images||before.storage.includes('Bring two majors'))throw Error('Layout, markup, or storage check failed');
 await page.screenshot({path:'output/playwright/coordinator-phase6-desktop.png',fullPage:true});
 await page.evaluate(()=>window.phase6Control('hold'));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.evaluate(async()=>{await window.phase6Control('end');window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
 await page.getByRole('alert').waitFor();
 await page.evaluate(()=>window.phase6Control('release'));
 await page.waitForFunction(()=>!document.querySelector('.guidance-card'));
 const ended=await page.evaluate(()=>({cards:document.querySelectorAll('.guidance-card').length,editor:document.querySelectorAll('.guidance-editor').length}));
 if(ended.cards||ended.editor)throw Error('A late response restored revoked content');
 await page.getByRole('button',{name:'Student view',exact:true}).click();
 await page.getByText('Sharing ended. This copy remains in your binder.',{exact:true}).waitFor();
 if(!await page.getByRole('button',{name:'Reply',exact:true}).isDisabled())throw Error('Reply remains enabled after sharing ended');
 await page.evaluate(()=>window.phase6Control('pause'));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.getByText('New guidance and replies are paused.',{exact:true}).waitFor();
 if(await page.locator('.guidance-card').count()!==1)throw Error('Pause erased student receipt');
 const state=await page.evaluate(()=>window.phase6Control('inspect'));
 if(state.errors.length)throw Error(state.errors.join(';'));
 return {before,ended,privateVoiceReplies:state.requests.filter(x=>x.action==='student-reply').length,errors:state.errors};
}
