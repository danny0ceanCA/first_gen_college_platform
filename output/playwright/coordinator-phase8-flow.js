// Substitute the fixture JSON in a temporary copy, as for the preview harness.
async page=>{
 const fixture=__PHASE8_BROWSER_FIXTURE__,results=[];
 const api=async(path,input)=>{const r=await page.request.post(fixture.base+'/api/'+path,{headers:{'x-synthetic-actor':'other','x-synthetic-secret':fixture.secret},data:{studentId:'alex',...input}});if(!r.ok())throw new Error('Synthetic setup failed');return r.json();};
 for(const language of ['en','es'])for(const device of ['mobile','desktop']){
  await api('binder-sharing',{action:'revoke-all'});
  for(const c of (await api('coordinator-connections',{action:'list'})).connections)if(['requested','accepted'].includes(c.status))await api('coordinator-connections',{action:'withdraw',connectionId:c.id});
  for(const f of (await api('coordinator-feedback',{action:'student-list'})).feedback)await api('coordinator-feedback',{action:'student-remove',feedbackId:f.id,version:f.version,requestId:crypto.randomUUID()});
  await page.setViewportSize(device==='mobile'?{width:390,height:844}:{width:1280,height:900});
  if(await page.getByRole('button',{name:'Coordinator view',exact:true}).isVisible())await page.getByRole('button',{name:'Coordinator view',exact:true}).click();
  await page.getByRole('button',{name:'Student view',exact:true}).click();
  const t=(a,b)=>language==='es'?b:a,button=(a,b)=>page.getByRole('button',{name:t(a,b),exact:true});
  const languageButton=page.getByRole('button',{name:language==='es'?'Español':'English',exact:true});if(await languageButton.isVisible())await languageButton.click();
  await button('Connect with a coordinator','Conectar con un coordinador').click();
  await page.getByRole('textbox',{name:t('Coordinator code','Código del coordinador'),exact:true}).fill(fixture.code);
  await button('Find coordinator','Buscar coordinador').click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('checkbox',{name:t('College options','Opciones universitarias'),exact:true}).check();
  await button('Confirm request','Confirmar solicitud').click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Coordinator view',exact:true}).click();await button('Accept','Aceptar').click();
  await page.getByRole('button',{name:'Student view',exact:true}).click();await button('People with access','Personas con acceso').click();
  await page.getByRole('combobox',{name:t('Coordinator','Coordinador'),exact:true}).selectOption({label:'staff · Synthetic Community Center'});
  await page.getByRole('checkbox',{name:t('College options','Opciones universitarias'),exact:true}).check();
  await page.getByRole('checkbox',{name:t('College options','Opciones universitarias')+' Compare biology programs.',exact:true}).check();
  await page.getByRole('button',{name:new RegExp(t('Review selected entries','Revisar notas seleccionadas'))}).click();await dialog.waitFor();
  if((await dialog.innerText()).includes('SENTINEL'))throw new Error('Unselected content appeared in preview');
  await button('Publish these entries','Publicar estas notas').click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Coordinator view',exact:true}).click();await page.getByRole('button',{name:new RegExp(t('Open shared binder','Abrir carpeta compartida'))}).click();
  await page.getByRole('navigation',{name:t('Shared binder topics','Temas compartidos')}).getByRole('button',{name:new RegExp(t('College options','Opciones universitarias'))}).click();
  if((await page.locator('main').innerText()).includes('SENTINEL'))throw new Error('Private content appeared for staff');
  await button('Write guidance in this topic','Escribir orientación en este tema').click();
  const guidance=t('Bring two programs to compare.','Trae dos programas para comparar.')+' '+device;
  await page.getByRole('textbox',{name:t('Your guidance','Tu orientación'),exact:true}).fill(guidance);await button('Save guidance for student','Guardar orientación para el estudiante').click();await page.getByText(guidance,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Student view',exact:true}).click();await page.getByText(guidance,{exact:true}).waitFor();
  const metrics=await page.evaluate(()=>{
   const body=document.querySelector('.guidance-body'),card=document.querySelector('.guidance-card');const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(x=>{x=Number(x)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
   const fg=luminance(getComputedStyle(body).color),bg=luminance(getComputedStyle(card).backgroundColor);
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,contrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),stored:/Compare biology|dos programas|two programs|SENTINEL/.test(JSON.stringify({...localStorage,...sessionStorage}))};
  });if(metrics.scrollWidth>metrics.width||metrics.contrast<4.5||metrics.stored)throw new Error('Layout, contrast or storage check failed');
  await page.screenshot({path:`output/playwright/coordinator-phase8-${language}-${device}.png`,fullPage:true});
  await button('Reply','Responder').focus();await page.keyboard.press('Enter');const reply=t('I will bring my questions.','Traeré mis preguntas.')+' '+device;
  await page.getByRole('textbox',{name:new RegExp(t('Reply to','Responder a'))}).fill(reply);await button('Send reply to coordinator','Enviar respuesta al coordinador').click();
  await page.getByRole('textbox',{name:new RegExp(t('Reply to','Responder a'))}).waitFor({state:'hidden'});
  await page.getByText(new RegExp(t('Edit history & replies','Historial y respuestas'))).click();await page.getByText(reply,{exact:true}).waitFor();
  await button('People with access','Personas con acceso').click();await button('Remove entry','Quitar nota').click();await button('Remove entry','Quitar nota').waitFor({state:'hidden'});
  await button('Stop sharing with this person','Dejar de compartir con esta persona').click();await button('Stop sharing with this person','Dejar de compartir con esta persona').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Coordinator view',exact:true}).click();await page.getByText(t('No shared binders match this view. Students must publish a selection before it appears here.','No hay carpetas para esta vista. Los estudiantes deben publicar una selección para que aparezca aquí.'),{exact:true}).waitFor();
  results.push({language,device,...metrics,workflowPassed:true});
 }
 return results;
}
