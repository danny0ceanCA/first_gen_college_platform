async page=>{
 // Run after loading coordinator-phase5-preview.js in a fresh browser session.
 await page.getByRole('button',{name:/Alex Rivera College options/}).click();
 await page.getByRole('button',{name:'College options 1',exact:true}).click();
 const note='Compare the campus visit dates before choosing where to apply.';
 await page.getByText(note,{exact:true}).waitFor();
 const sizes=[];
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});sizes.push(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})));}
 if(sizes.some(x=>x.scroll>x.width))throw new Error('horizontal_overflow');
 await page.getByRole('button',{name:'Español',exact:true}).click();
 await page.getByRole('button',{name:'Pagar la universidad 1',exact:true}).click();
 await page.getByText('¿Qué preguntas debo preparar para mi reunión sobre ayuda financiera?',{exact:true}).waitFor();
 const storage=await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]));
 if(storage.includes('Alex Rivera')||storage.includes('Compare the campus')||storage.includes('preguntas debo'))throw new Error('publication_persisted');
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'College options 1',exact:true}).click();
 await page.evaluate(()=>window.phase5Control('hold'));
 await page.getByRole('button',{name:'Refresh binders',exact:true}).click();
 await page.evaluate(async()=>{await window.phase5Control('revoke');window.dispatchEvent(new Event('focus'));});
 await page.getByRole('alert').waitFor();
 await page.evaluate(()=>window.phase5Control('release'));
 await page.waitForFunction(()=>!document.querySelector('.coordinator-shared-binder'));
 if(await page.getByText(note,{exact:true}).count())throw new Error('stale_read_resurrected');
 await page.getByRole('button',{name:'Return to shared binders',exact:true}).click();
 await page.getByText('No shared binders match this view. Students must publish a selection before it appears here.',{exact:true}).waitFor();
 await page.evaluate(()=>window.phase5Control('pause'));
 await page.getByRole('button',{name:'Refresh binders',exact:true}).click();
 await page.getByRole('alert').waitFor();
 if(!(await page.getByRole('alert').textContent()).includes('Binder viewing is paused'))throw new Error('paused_state_missing');
 const state=await page.evaluate(()=>window.phase5Control('status'));
 if(state.errors.length)throw new Error(JSON.stringify(state.errors));
 return {sizes,spanish:true,noPublicationStorage:true,lateResponseRejected:true,revokedAndPausedCleared:true,browserErrors:state.errors};
}
