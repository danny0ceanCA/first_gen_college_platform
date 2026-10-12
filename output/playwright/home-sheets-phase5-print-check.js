async page => {
 const area=page.locator('.workspace-sheets');
 await area.getByRole('button',{name:'Sofía',exact:true}).click();
 await area.getByRole('button',{name:'Abrir y revisar',exact:true}).first().click();
 await area.getByRole('button',{name:'Revisar mi hoja',exact:true}).click();
 await area.getByRole('checkbox',{name:'Revisé el contenido y lo que quiero incluir.',exact:true}).check();
 await page.evaluate(()=>{
  window.printCheck=null;
  document.addEventListener('load',event=>{
   const frame=event.target;
   if(!(frame instanceof HTMLIFrameElement)||frame.title!=='Imprimir hoja revisada')return;
   frame.contentWindow.print=()=>{
    window.printCheck={title:frame.contentDocument.title,text:frame.contentDocument.body.innerText};
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
   };
  },true);
 });
 await area.getByRole('button',{name:'Imprimir / guardar PDF',exact:true}).click();
 await page.waitForFunction(()=>window.printCheck!==null);
 const result=await page.evaluate(()=>window.printCheck);
 if(!result.text.includes('Which courses transfer?')||result.text.includes('synthetic-sofia'))throw Error('Wrong print content');
 if(await page.locator('iframe[title="Imprimir hoja revisada"]').count())throw Error('Print frame not cleaned up');
 return {passed:true,reviewedContent:true,afterPrintCleanup:true,nativePrintDialog:'stubbed'};
}
