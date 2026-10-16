import {createHash} from 'node:crypto';
export const dashboardId='dashboard:7c631aeb-c135-4354-bcaf-58ff19195c10';
export const dashboardPrefix='/bdmin/thinkwithblack';
export const dashboardApi='/api/bdmin/thinkwithblack';
export const digest=(body:string)=>createHash('sha256').update(body).digest('hex');
type Query=(sql:string,values?:any[])=>Promise<{rows:any[]}>;
export function createDashboardRepository(query:Query){
  let ready:Promise<unknown>|null=null;
  const ensure=()=>ready??=(query(`CREATE TABLE IF NOT EXISTS thinkwithblack_dashboard_snapshots (hash varchar(64) PRIMARY KEY, body text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now())`).catch(e=>{ready=null;throw e;}));
  return {
    async latest(){await ensure();return (await query('SELECT hash, body FROM thinkwithblack_dashboard_snapshots ORDER BY captured_at DESC LIMIT 1')).rows[0]??null;},
    async get(hash:string){await ensure();return (await query('SELECT hash, body FROM thinkwithblack_dashboard_snapshots WHERE hash = $1',[hash])).rows[0]??null;},
    async put(body:string){await ensure();const hash=digest(body);await query('INSERT INTO thinkwithblack_dashboard_snapshots (hash,body) VALUES ($1,$2) ON CONFLICT (hash) DO NOTHING',[hash,body]);return {hash,body};},
  };
}
export type SnapshotRecord={hash:string;body:string};
export type DashboardRepository={latest():Promise<SnapshotRecord|null>;get(hash:string):Promise<SnapshotRecord|null>;put(body:string):Promise<SnapshotRecord>};
export function assembleSnapshot(raw:any,members:any[],verifiedAt:string){
  if(!raw||!Array.isArray(raw.usage)||!Array.isArray(raw.grants)||!Array.isArray(raw.questions)||!Array.isArray(raw.users)||!Number.isFinite(Date.parse(raw.generatedAt)))throw new Error('SOURCE_INVALID');
  const memberMap=new Map(members.map(m=>[String(m.id),m]));
  const users=raw.users.map((u:any)=>{const m=memberMap.get(String(u.member_id));return {...u,email:m?.email?.trim().toLowerCase()??null,plan:['free','pro','founders'].includes(m?.membershipLevel)?m.membershipLevel:'unknown',identity_source:'ECCAL 會員資料庫',identity_verified_at:verifiedAt};});
  const hashMap=new Map(users.map((u:any)=>[u.user_hash,u]));
  const platforms=new Map(raw.grants.map((g:any)=>[g.client_hash,g.platform]));
  const enrich=(r:any)=>{const member:any=hashMap.get(r.user_hash);return {...r,email:member?.email??null,account:member?.email??`會員 ${String(r.user_hash).slice(0,10)}`,plan:member?.plan??'unknown',internal:(r.user_hash===raw.owner.user_hash||member?.email==='backtrue@gmail.com')?'internal':'external',platform:r.platform??platforms.get(r.client_hash)??'未辨識平台'};};
  const provenance={...raw.provenance,members:{...raw.provenance.members,executedAt:verifiedAt,classification:'observed',name:'ECCAL 會員資料庫',evidenceFlow:[{title:'會員對照',detail:'在報數據後端依 MCP 會員 ID 查詢目前 Email 與會員方案'}]}};
  const query=(rows:any[],source:any)=>({rows,source:{...source,label:source.name},methods:[]});
  const queries={usage:query(raw.usage.map(enrich),provenance.usage),grants:query(raw.grants.map(enrich),provenance.grants),members:query(users.map(enrich),provenance.members),questions:query(raw.questions.map(enrich),provenance.questions),github:query(raw.github,provenance.github),traffic:query(raw.traffic,provenance.traffic??provenance.github),history:query(raw.history,{...provenance.github,name:'每日來源快照'}),source_status:query(Object.entries(provenance).map(([id,v])=>{const s:any=v;return {id,name:s.name,status:id==='traffic'?'最近成功讀取':'已讀取',updated_at:s.executedAt,coverage:s.coverage??''};}),{name:'來源更新狀態',classification:'observed',executedAt:raw.generatedAt})};
  return {id:dashboardId,title:'ThinkWithBlack 營運總覽',surface:'dashboard',status:'observed',buildStatus:'complete',generatedAt:raw.generatedAt,filters:[],queries,dashboard:{owner:raw.owner,skillNames:raw.skillNames,coverageStart:provenance.usage.coverage,defaultExcludeOwner:true,timezone:'Asia/Taipei',version:1,apiBase:dashboardApi}};
}
