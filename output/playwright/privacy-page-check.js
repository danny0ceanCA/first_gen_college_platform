async page=>{
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 const main=page.locator('main');
 await page.emulateMedia({reducedMotion:'reduce'});
 check(await main.locator('.privacy-section').count()===8,'Missing policy sections');
 const english=await main.innerText();
 check(!/review draft|updated october|2026/i.test(english),'Draft/date label remains');
 for(const text of ['Blueprint Holdings LLC','13–17','180 days','365 days','Resend','OpenAI','Auth0','Render','Google Fonts','until you delete'])check(english.includes(text),'Missing disclosure: '+text);
 check(await main.locator('a[href="mailto:daniel@origenedu.ai"]').count()>0,'Missing privacy request link');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Horizontal overflow: '+width);
 }
 await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'output/playwright/privacy-page-desktop.png'});
 await page.getByRole('button',{name:'Providers, staff and browser storage',exact:true}).click();
 check(new URL(page.url()).hash==='#privacy','Contents navigation changed public route');
 check(await page.evaluate(()=>document.activeElement?.id==='privacy-section-4'),'Contents failed to focus heading');
 await page.locator('#privacy-section-4').locator('..').screenshot({path:'output/playwright/privacy-providers-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('#privacy-section-4').locator('..').screenshot({path:'output/playwright/privacy-providers-mobile.png'});
 await page.locator('#privacy-section-6').locator('..').screenshot({path:'output/playwright/privacy-guardian-mobile.png'});
 await page.getByRole('button',{name:'Ver en español',exact:true}).click();
 check(await page.locator('html').getAttribute('lang')==='es','Spanish language attribute missing');
 const spanish=await main.innerText();
 for(const text of ['Elegibilidad y permiso del tutor','48 horas','180 días','365 días','No vendemos','Resend','daniel@origenedu.ai'])check(spanish.includes(text),'Missing Spanish disclosure: '+text);
 check(!/review draft|actualizado|2026/i.test(spanish),'Spanish draft/date remains');
 await page.getByRole('button',{name:'Elegibilidad y permiso del tutor',exact:true}).click();
 check(await page.evaluate(()=>document.activeElement?.id==='privacy-section-6'),'Spanish contents navigation failed');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Spanish mobile overflow');
 await page.locator('#privacy-section-6').locator('..').screenshot({path:'output/playwright/privacy-guardian-mobile-es.png'});
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'output/playwright/privacy-page-mobile-es.png'});
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));
 console.log('PASS: eight sections, both languages, provider/contact links, section focus, route preserved, no draft/date labels, no overflow at 320/390/1440px.');
}
