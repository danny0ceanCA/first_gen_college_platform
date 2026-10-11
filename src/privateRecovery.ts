import {onboardingRecovery} from './onboardingRecovery.mjs';
import {browserPrivacy} from './browserPrivacy.mjs';
export function privateRecovery(key:string){return onboardingRecovery(browserPrivacy.storage(key),key);}
