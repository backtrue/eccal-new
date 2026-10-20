import {defaultScope} from './metrics.mjs';
export const refreshInterval=24*60*60*1000;
const scopeKey=id=>`twb-dashboard-refresh:${id}`;
export function restoredScope(snapshot,storage){
  const initial=defaultScope(snapshot);
  try{
    const saved=storage.getItem(scopeKey(snapshot.id));storage.removeItem(scopeKey(snapshot.id));
    if(!saved)return initial;
    const {scope,defaultRange}=JSON.parse(saved);
    if(typeof scope?.range!=='string'||!/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(scope.range)||typeof scope.platform!=='string'||typeof scope.plan!=='string'||typeof scope.includeOwner!=='boolean')return initial;
    return {...scope,range:scope.range===defaultRange?initial.range:scope.range};
  }catch{return initial;}
}
export function rememberScope(snapshot,scope,storage){
  try{storage.setItem(scopeKey(snapshot.id),JSON.stringify({scope,defaultRange:defaultScope(snapshot).range}));}catch{}
}
export function startAutoRefresh({snapshot,canRefresh,onUpdated,onError,fetcher=fetch,documentTarget=document,windowTarget=window,now=Date.now,setTimer=setInterval,clearTimer=clearInterval}){
  let stopped=false,pending=false,nextAttempt=Date.parse(snapshot.generatedAt)+refreshInterval;
  const abort=new AbortController();
  async function check(){
    if(stopped||pending||documentTarget.visibilityState!=='visible'||!canRefresh()||now()<nextAttempt)return;
    pending=true;nextAttempt=now()+refreshInterval;
    try{
      const r=await fetcher(`${snapshot.dashboard.apiBase??'/api'}/snapshot`,{cache:'no-store',signal:abort.signal});
      const data=await r.json();if(!r.ok)throw new Error(data.error??'資料更新失敗');
      if(!Number.isFinite(Date.parse(data.generatedAt)))throw new Error('資料更新時間無效');
      if(!stopped&&canRefresh()&&data.generatedAt!==snapshot.generatedAt)onUpdated();
    }catch(e){if(!stopped)onError(e.message);}finally{pending=false;}
  }
  const timer=setTimer(check,30000);
  documentTarget.addEventListener('visibilitychange',check);windowTarget.addEventListener('focus',check);check();
  return ()=>{stopped=true;abort.abort();clearTimer(timer);documentTarget.removeEventListener('visibilitychange',check);windowTarget.removeEventListener('focus',check);};
}
