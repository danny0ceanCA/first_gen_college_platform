import test from 'node:test';
import assert from 'node:assert/strict';
import {Module,createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';

// Render the actual shared onboarding launcher, not a copy of its JSX.
// Compilation stays in memory; no database, microphone or provider is involved.
const require=createRequire(import.meta.url);
const filename=fileURLToPath(new URL('../.onboarding-disclosure-test.cjs',import.meta.url));
const result=await build({stdin:{contents:"export {default as ProfileVoice} from './src/ProfileVoice'; export {SharedVoiceContext} from './src/SharedVoiceContext';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},logLevel:'silent'});
const compiled=new Module(filename);
compiled.filename=filename;compiled.paths=require.resolve.paths('react');
compiled._compile(result.outputFiles[0].text,filename);
const {ProfileVoice,SharedVoiceContext}=compiled.exports;

for(const language of ['en','es'])for(const active of [false,true])test(`onboarding ${language} ${active?'active':'idle'} exposes processing and automatic saving before the launch control`,()=>{
 let launches=0;
 const shared={active,launch:()=>launches++,open:()=>{},syncOnboarding:()=>{}};
 const markup=renderToStaticMarkup(React.createElement(SharedVoiceContext.Provider,{value:shared},React.createElement(ProfileVoice,{onboarding:true,language,role:'student',profile:{id:'synthetic',name:'',stage:'',interest:'',gpa:'',color:'lilac'},t:(en,es)=>language==='es'?es:en,apply:()=>{},onActive:()=>{}})));
 const describedBy=markup.match(/aria-describedby="([^"]+)"/)?.[1];
 assert.ok(describedBy);assert.ok(markup.includes(`id="${describedBy}"`));
 assert.ok(markup.indexOf('OpenAI')<markup.indexOf('<button'));
 assert.match(markup,language==='en'?/microphone audio and the profile details/:/audio del micrófono y los datos del perfil/);
 assert.match(markup,language==='en'?/automatically when the call ends, without separate approval/:/automáticamente al terminar la llamada, sin aprobación adicional/);
 assert.match(markup,language==='en'?/may wait until you save the profile/:/puede esperar hasta que guardes el perfil/);
 assert.match(markup,language==='en'?/Saving your profile is a separate action/:/Guardar el perfil es una acción separada/);
 assert.match(markup,language==='en'?/retention is separate/:/retención de OpenAI es independiente/);
 assert.equal(launches,0);
});

test('spoken onboarding instructions answer privacy questions without implying summary approval',()=>{
 for(const language of ['en','es']){
  const instructions=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(instructions,/without separate summary approval/);
  assert.match(instructions,/account save can wait for the profile to exist/);
  assert.match(instructions,/Saving the profile is a separate user request/);
  assert.doesNotMatch(instructions,/Do not .*explain features or summaries/);
  const home=homeVoiceIntroduction(language);
  assert.match(home,language==='en'?/saves automatically, without separate approval/:/guarda automáticamente, sin aprobación adicional/);
 }
});
