import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshInterval,startAutoRefresh,rememberScope,restoredScope} from './content/auto-refresh.mjs';
import {defaultScope} from './content/metrics.mjs';
const snapshot={id:'fixture',generatedAt:'2026-10-16T12:00:00Z',dashboard:{apiBase:'/api/bdmin/thinkwithblack'}};
function fixture(){
 const state={now:Date.parse(snapshot.generatedAt),blocked:false,calls:0,updated:0,errors:[],fail:false,wait:null};
 const doc=Object.assign(new EventTarget(),{visibilityState:'visible'}),win=new EventTarget();let check;
 const stop=startAutoRefresh({snapshot,canRefresh:()=>!state.blocked,onUpdated:()=>state.updated++,onError:e=>state.errors.push(e),documentTarget:doc,windowTarget:win,now:()=>state.now,setTimer:fn=>{check=fn;return 1;},clearTimer:()=>{},fetcher:async(url,options)=>{assert.equal(url,'/api/bdmin/thinkwithblack/snapshot');assert.equal(options.cache,'no-store');state.calls++;if(state.wait)await state.wait;if(state.fail)return Response.json({error:'SOURCE_UNAVAILABLE'},{status:502});return Response.json({generatedAt:new Date(state.now).toISOString()});}});
 return {state,doc,win,stop,check:()=>check()};
}
test('滿二十四小時才自動取新資料，背景分頁與編輯狀態暫停',async()=>{
 assert.equal(refreshInterval,86400000);
 const f=fixture();await f.check();assert.equal(f.state.calls,0);f.state.now+=refreshInterval-1;await f.check();assert.equal(f.state.calls,0);f.state.now+=1;f.doc.visibilityState='hidden';await f.check();assert.equal(f.state.calls,0);
 f.doc.visibilityState='visible';f.state.blocked=true;await f.check();assert.equal(f.state.calls,0);f.state.blocked=false;await f.check();assert.equal(f.state.calls,1);assert.equal(f.state.updated,1);f.stop();
});
test('切回分頁立即檢查，並行檢查共用請求，卸載後不換頁',async()=>{
 const f=fixture();f.state.now+=refreshInterval;let release;f.state.wait=new Promise(resolve=>{release=resolve;});f.doc.dispatchEvent(new Event('visibilitychange'));f.win.dispatchEvent(new Event('focus'));await f.check();assert.equal(f.state.calls,1);f.stop();release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.updated,0);f.win.dispatchEvent(new Event('focus'));assert.equal(f.state.calls,1);
});
test('更新失敗顯示錯誤，下一日重新檢查',async()=>{
 const f=fixture();f.state.now+=refreshInterval;f.state.fail=true;await f.check();assert.deepEqual(f.state.errors,['SOURCE_UNAVAILABLE']);assert.equal(f.state.updated,0);await f.check();assert.equal(f.state.calls,1);f.state.fail=false;f.state.now+=refreshInterval;await f.check();assert.equal(f.state.updated,1);f.stop();
});
test('更新保留選定篩選，預設日期跨日推進且只還原一次',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),removeItem:k=>data.delete(k),setItem:(k,v)=>data.set(k,v)};
 const scope={range:'2026-10-01..2026-10-07',platform:'Claude',plan:'pro',includeOwner:true};rememberScope(snapshot,scope,storage);assert.deepEqual(restoredScope(snapshot,storage),scope);assert.deepEqual(restoredScope(snapshot,storage),defaultScope(snapshot));
 rememberScope(snapshot,defaultScope(snapshot),storage);const next={...snapshot,generatedAt:'2026-10-17T12:00:00Z'};assert.deepEqual(restoredScope(next,storage),defaultScope(next));
});
