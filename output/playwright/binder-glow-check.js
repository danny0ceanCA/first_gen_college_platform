async page=>{
 page.setDefaultTimeout(10000);
 const check=(value,message)=>{if(!value)throw Error(message);};
 await page.setViewportSize({width:1280,height:960});
 await page.evaluate(()=>window.__binderActivity.begin('synthetic-call','synthetic','student-a',['costs','applications']));
 await page.waitForFunction(()=>document.querySelectorAll('.notebook-topic.is-discussing').length===2);
 check(await page.getByRole('tab',{name:/Summary/}).getAttribute('aria-selected')==='true','Conversation switched the selected tab');
 await page.evaluate(()=>window.__addNote('transfer','new-transfer'));
 await page.waitForFunction(()=>document.querySelector('.divider-transfer.has-new-notes'));
 check(await page.getByRole('tab',{name:/Summary/}).getAttribute('aria-selected')==='true','Saved notes switched tabs');
 const colors=await page.locator('.notebook-topic.is-discussing').evaluateAll(nodes=>nodes.map(node=>({topic:node.className,glow:getComputedStyle(node).getPropertyValue('--topic-glow'),animation:getComputedStyle(node,'::after').animationName})));
 check(new Set(colors.map(c=>c.glow)).size===2,'Topics do not have distinct glow colors');
 await page.screenshot({path:'output/playwright/binder-glow-desktop.png',fullPage:true});
 await page.getByRole('tab',{name:/Transfer & courses/}).click();
 const note=page.locator('[data-note-id="new-transfer"]');
 await note.scrollIntoViewIfNeeded();
 check(await note.evaluate(n=>n.classList.contains('notebook-note-new')),'Saved note did not highlight');
 await page.screenshot({path:'output/playwright/binder-glow-new-note.png',fullPage:true});
 await page.waitForFunction(()=>!document.querySelector('[data-note-id="new-transfer"]').classList.contains('notebook-note-new'),{timeout:11000});
 await page.setViewportSize({width:390,height:844});
 if(await page.getByRole('button',{name:'Topics',exact:true}).isVisible())await page.getByRole('button',{name:'Topics',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.notebook-contents-topic.is-discussing').length===2);
 await page.screenshot({path:'output/playwright/binder-glow-mobile.png',fullPage:true});
 for(const width of [320,390,760,968,1280]){
  await page.setViewportSize({width,height:900});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Horizontal overflow at '+width);
 }
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 check(await page.locator('.notebook-contents-topic.is-discussing').first().evaluate(n=>getComputedStyle(n,'::after').animationName)==='none','Reduced motion still animates');
 await page.evaluate(()=>window.__binderActivity.begin('family-call','synthetic',null,['options']));
 await page.waitForFunction(()=>!document.querySelector('.is-discussing'));
 await page.getByRole('button',{name:'Family notes',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.divider-options.is-discussing'));
 await page.evaluate(()=>window.__binderActivity.begin('other-account-call','other-account',null,['costs']));
 await page.waitForFunction(()=>!document.querySelector('.is-discussing'));
 await page.evaluate(()=>window.__binderActivity.clear());
 return {passed:true,widths:[320,390,760,968,1280],colors,checks:['no automatic tab changes','new saved note glow','read marker clears after viewing','mobile topic glows','no horizontal overflow','reduced motion','student/family isolation','account isolation']};
}
