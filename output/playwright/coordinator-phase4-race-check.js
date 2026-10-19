async page=>{
 // Run after coordinator-phase4-preview.js, with the fictional API in place.
 await page.getByRole('button',{name:'People with access',exact:true}).click();
 await page.getByRole('combobox',{name:'Coordinator',exact:true}).selectOption('00000000-0000-4000-8000-000000000003');
 await page.getByRole('button',{name:'All eligible topics',exact:true}).click();
 await page.getByRole('checkbox',{name:'College options Compare the campus visit dates before choosing where to apply.',exact:true}).check();
 await page.getByRole('button',{name:'Review selected entries (1/50)',exact:true}).click();
 await page.getByRole('button',{name:'Publish these entries',exact:true}).click();
 await page.getByRole('button',{name:'Stop all sharing',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close sharing',exact:true}).click();
 let delayed=false,release,completed;
 const intercepted=new Promise(r=>completed=r);
 await page.route('**/api/binder-sharing',async route=>{
  if(route.request().postDataJSON().action!=='status'||delayed)return route.fallback();
  delayed=true;await new Promise(r=>release=r);
  await route.fulfill({contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({available:true,enabled:true,connections:[],grants:[{id:'old',status:'active',coordinatorName:'Marisol Rivera',organizationName:'Community Futures',expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['options'],items:[{id:'old',topic:'options',content:'STALE_SHARING_TEXT'}]}]})});completed();
 });
 await page.getByRole('button',{name:'People with access',exact:true}).click();
 await page.getByRole('button',{name:'Stop all sharing',exact:true}).click();
 await page.getByText('Community Futures · Access ended or unavailable',{exact:true}).waitFor();
 if(!delayed)throw new Error('Delayed refresh was not exercised');
 release();await intercepted;
 // Allow React to process the released older response before inspecting state.
 await page.waitForTimeout(100);
 if(await page.getByText('STALE_SHARING_TEXT',{exact:true}).count())throw new Error('Old response restored revoked content');
 return {delayedRefreshIgnored:true,revokedContentCleared:true};
}
