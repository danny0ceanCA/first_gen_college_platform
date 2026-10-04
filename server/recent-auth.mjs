export const AUTH_TIME_CLAIM='https://origenedu.ai/auth_time';
export function recentlyAuthenticated(identity,now=Date.now()){
 const time=identity?.[AUTH_TIME_CLAIM],seconds=Math.floor(now/1000);
 return Number.isSafeInteger(time)&&time>0&&time<=seconds&&seconds-time<=300;
}
