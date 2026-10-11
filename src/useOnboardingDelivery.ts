import {useEffect} from 'react';
import type {OnboardingTracker} from './onboardingEvents.mjs';
import {browserPrivacy} from './browserPrivacy.mjs';
export function useOnboardingDelivery(tracker:OnboardingTracker,ready=true){
 useEffect(()=>{
  if(!ready)return;
  const recover=()=>{if(!document.hidden)tracker.resume();},closed=()=>tracker.clear();
  tracker.resume();window.addEventListener('online',recover);document.addEventListener('visibilitychange',recover);window.addEventListener('origen-account-closed',closed);
  const stop=browserPrivacy.subscribe(event=>{if(event.type==='end')tracker.clear();});
  return()=>{stop();tracker.pause();window.removeEventListener('online',recover);document.removeEventListener('visibilitychange',recover);window.removeEventListener('origen-account-closed',closed);};
 },[tracker,ready]);
}
export function onboardingStorage(){try{return window.localStorage;}catch{return undefined;}}
