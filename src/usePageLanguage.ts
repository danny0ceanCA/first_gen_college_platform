import {useEffect} from 'react';
export function usePageLanguage(language:'en'|'es'){
 useEffect(()=>{document.documentElement.lang=language;},[language]);
}
