async page=>{
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const requests=async()=>{const d=await page.evaluate(()=>window.phase4Diagnostics());return d.requests.filter(r=>r.path==='/api/profile-voice');};
 const waitRequest=async(start,predicate)=>{for(let attempt=0;attempt<100;attempt++){const match=(await requests()).slice(start).find(r=>predicate(r.body));if(match)return match.body;await page.waitForTimeout(50);}throw Error('Expected voice request did not arrive');};
 const baseline=(await requests()).length;await page.setViewportSize({width:1440,height:1000});await page.reload();
 const notebook=page.locator('.topic-notebook'),plan=page.locator('.action-plan');
 const collapse=async()=>{const button=page.getByRole('button',{name:'Close conversation details',exact:true});if(await button.count())await button.click();};
 const width=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
 await notebook.getByRole('button',{name:/^Transfer & courses/}).click();await notebook.locator('.notebook-note-actions').getByRole('button',{name:'Talk about this',exact:true}).click();await page.getByRole('button',{name:'End conversation',exact:true}).waitFor();
 await page.waitForFunction(()=>window.voiceFixture.messages.some(m=>m.type==='response.create'));
 const initial=(await requests()).slice(baseline)[0].body;assert(initial.workspaceFocus.kind==='note'&&initial.workspaceFocus.noteId.startsWith('aaaaaaaa'),'Question focus omitted');assert(initial.studentId==='synthetic-sofia'&&initial.targetConfirmed,'Explicit student scope missing');assert(!initial.scopeRestart,'New conversation skips Hola');
 await page.evaluate(()=>{window.voiceEmit({type:'input_audio_buffer.speech_started',item_id:'spanish'});window.voiceEmit({type:'input_audio_buffer.speech_stopped',item_id:'spanish'});window.voiceEmit({type:'conversation.item.input_audio_transcription.completed',item_id:'spanish',transcript:'Quiero saber como puedo pagar la universidad.'});});
 await page.waitForFunction(()=>window.voiceFixture.messages.some(m=>m.type==='session.update'&&m.session.instructions.includes('Current conversation language: Spanish')));
 await page.waitForFunction(()=>window.voiceFixture.reply>=2);await page.waitForTimeout(150);
 // Hold actual playback after response.done; a click must not interrupt it.
 await page.evaluate(()=>{window.voiceEmit({type:'response.created',response:{id:'held'}});window.voiceEmit({type:'output_audio_buffer.started',response_id:'held'});window.voiceEmit({type:'response.done',response:{id:'held',status:'completed',output:[]}});});
 const before=(await requests()).length;
 await notebook.getByRole('button',{name:/^Paying for college/}).click();await notebook.locator('.notebook-toolbar').getByRole('button',{name:'Talk about this',exact:true}).click();
 await page.getByText('We’ll pick this up after the current reply.',{exact:true}).waitFor();await page.waitForTimeout(250);assert((await requests()).length===before,'Changed configuration before playback finished');
 await page.evaluate(()=>window.voiceEmit({type:'output_audio_buffer.stopped',response_id:'held'}));

 const cost=await waitRequest(before,body=>body.action==='update-guide'&&body.workspaceFocus?.topic==='costs');assert(cost.language==='es'&&cost.mode==='finance','Focus change lost Spanish or wrong specialty: '+JSON.stringify(cost));
 const beforeTask=(await requests()).length;await collapse();await plan.locator('.saved-actions').getByRole('button',{name:'Talk about this',exact:true}).click();

 const task=await waitRequest(beforeTask,body=>body.workspaceFocus?.kind==='action');assert(task.workspaceFocus.stepId==='counselor'&&task.workspaceFocus.version===1,'Wrong task or missing version');
 const state=await page.evaluate(()=>window.voiceFixture);assert(state.connections===1&&state.closed===0,'Topic selection recreated audio');assert(!state.messages.some(m=>m.type==='response.cancel'),'Topic click cancelled a reply');assert(state.messages.filter(m=>m.type==='session.update').every(m=>!m.session.audio&&!m.session.model),'Configuration changed audio settings');
 await collapse();await page.screenshot({path:'output/playwright/home-voice-phase4-desktop.png',fullPage:true,animations:'disabled'});
 await page.evaluate(()=>fetch('/api/test-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voiceFail:true})}));await plan.locator('.saved-actions').getByRole('button',{name:'Talk about this',exact:true}).click();await page.getByText('Could not open that saved item.',{exact:false}).waitFor();assert(await page.getByRole('button',{name:'End conversation',exact:true}).count()===1,'Stale item ended call');
 await page.evaluate(()=>fetch('/api/test-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voiceFail:false})}));await collapse();
 await page.locator('.home-student-selector').getByRole('button',{name:'Mateo',exact:true}).click();await notebook.getByRole('button',{name:/^Transfer & courses/}).click();const beforeSibling=(await requests()).length;await notebook.locator('.notebook-toolbar').getByRole('button',{name:'Talk about this',exact:true}).click();await page.getByText('This call is about a different person or family scope.',{exact:false}).waitFor();assert((await requests()).length===beforeSibling,'Cross-student details entered live call');
 await page.getByRole('button',{name:'End conversation',exact:true}).click();await page.getByRole('button',{name:'Talk with Origen',exact:true}).first().waitFor();
 await page.getByRole('button',{name:/^ES/}).click();await page.setViewportSize({width:390,height:844});await notebook.scrollIntoViewIfNeeded();await width();await page.screenshot({path:'output/playwright/home-voice-phase4-mobile.png',fullPage:true,animations:'disabled'});
 await notebook.getByRole('button',{name:'Notas familiares',exact:true}).click();await notebook.getByRole('button',{name:/^Pagar la universidad/}).click();await notebook.locator('.notebook-toolbar').getByRole('button',{name:'Hablemos de esto',exact:true}).click();await page.getByRole('button',{name:'Terminar conversación',exact:true}).waitFor();
 const family=(await requests()).at(-1).body;assert(family.studentId===null&&family.targetConfirmed&&family.language==='es','Family focus inherited student or wrong language');await page.setViewportSize({width:320,height:720});await width();
 await page.getByRole('button',{name:'Terminar conversación',exact:true}).click();
 const d=await page.evaluate(()=>window.phase4Diagnostics());assert(!d.errors.length,d.errors.join('; '));assert(!d.requests.some(r=>r.path.endsWith('-research')||r.path==='/api/topic-notes'&&r.body.action==='suggest'),'Unexpected lookup or extraction');
 return {passed:true,noteAndTaskLaunch:true,topicContinuity:true,oneConnectionAcrossTopics:true,waitsForPlayback:true,preservesSpanish:true,staleItemRecovery:true,scopeIsolation:true,familyLaunch:true,mobile390:true,mobile320:true};
}


