interface KV {list(input:{prefix:string;cursor?:string;limit?:number}):Promise<{keys:{name:string}[];list_complete:boolean;cursor?:string}>;get(key:string,type:'json'):Promise<any>;put(key:string,value:string):Promise<void>}
interface Env {OAUTH_KV:KV;ORIGINAL_QUESTIONS:KV;DASHBOARD_KV:KV;ANALYTICS_SQL:{query(input:{query:string;params?:Record<string,string>}):Promise<{data:any[]}>}}
const ownerEmail='backtrue@gmail.com';
const platformNames:Record<string,string>={'https://chatgpt.com/oauth/client.json':'ChatGPT','https://claude.ai/oauth/mcp-oauth-client-metadata':'Claude','https://chatgpt.com/oauth/codex/client.json':'Codex'};
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const day=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
class Failure extends Error {constructor(readonly status:number,readonly code:string){super(code)}}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
async function mapLimit<T,R>(rows:T[],fn:(row:T)=>Promise<R>){const out:R[]=new Array(rows.length);let next=0;await Promise.all(Array.from({length:Math.min(6,rows.length)},async()=>{while(next<rows.length){const n=next++;out[n]=await fn(rows[n]);}}));return out;}
async function list(kv:KV,prefix:string){let cursor:string|undefined;const keys:{name:string}[]=[];do{const r=await kv.list({prefix,cursor,limit:1000});keys.push(...r.keys);cursor=r.list_complete?undefined:r.cursor;if(!r.list_complete&&!cursor)throw new Failure(502,'SOURCE_PAGINATION');}while(cursor);return keys;}
async function identity(request:Request,fetcher:typeof fetch){
  const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer ')||authorization.length>8200)throw new Failure(401,'LOGIN_REQUIRED');
  let r:Response;try{r=await fetcher('https://eccal.thinkwithblack.com/api/auth/check',{headers:{authorization,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new Failure(503,'IDENTITY_UNAVAILABLE');}
  if(r.status===401||r.status===403)throw new Failure(401,'LOGIN_REQUIRED');if(!r.ok)throw new Failure(503,'IDENTITY_UNAVAILABLE');
  const body:any=await r.json();if(body.isAuthenticated!==true||typeof body.user?.id!=='string'||typeof body.user?.email!=='string')throw new Failure(401,'LOGIN_REQUIRED');
  if(body.user.email.trim().toLowerCase()!==ownerEmail)throw new Failure(403,'OWNER_REQUIRED');return body.user.id as string;
}
function instant(value:unknown){const s=String(value);return /[zZ]$|[+-]\d\d:\d\d$/.test(s)?s:s.replace(' ','T')+'Z';}
async function collect(env:Env,userId:string,fetcher:typeof fetch){
  const generatedAt=new Date().toISOString(),ownerHash=await sha(userId);
  const [grantKeys,questionKeys,prior]=await Promise.all([list(env.OAUTH_KV,'grant:'),list(env.ORIGINAL_QUESTIONS,'questions/'),env.DASHBOARD_KV.get('snapshot','json')]);
  const rawGrants=await mapLimit(grantKeys,k=>env.OAUTH_KV.get(k.name,'json'));
  const grants=await mapLimit(rawGrants,async g=>({grant_id:g.id,user_hash:await sha(String(g.userId)),client_hash:await sha(String(g.clientId)),platform:platformNames[g.clientId]??'未辨識平台',created_at:new Date(g.createdAt*1000).toISOString(),expires_at:Number.isFinite(g.expiresAt)?new Date(g.expiresAt*1000).toISOString():null,scopes:Array.isArray(g.scope)?g.scope.join(','):''}));
  const userIds=[...new Set(rawGrants.map(g=>String(g.userId)))];
  const users=await mapLimit(userIds,async id=>({member_id:id,user_hash:await sha(id)}));
  const clientMap=new Map(await mapLimit(rawGrants,async g=>[await sha(String(g.clientId)),platformNames[g.clientId]??'未辨識平台'] as const));
  const questions=await mapLimit(questionKeys,async k=>{const q=await env.ORIGINAL_QUESTIONS.get(k.name,'json');if(typeof q?.original_question!=='string'||q.question_sha256!==await sha(q.original_question))throw new Failure(502,'QUESTION_INTEGRITY');return {record_id:q.record_id,date:day(q.received_at),received_at:q.received_at,original_question:q.original_question,characters:q.characters,utf8_bytes:q.utf8_bytes,question_sha256:q.question_sha256,user_hash:q.user_hash,client_hash:q.client_hash,deployment_version:q.deployment_version};});
  const intervals:[string,string][]=[];const cutoff=Date.parse(generatedAt);for(let start=cutoff-89*86400000;start<cutoff;start+=7*86400000)intervals.push([new Date(start).toISOString(),new Date(Math.min(start+7*86400000,cutoff)).toISOString()]);
  const sqls:string[]=[];
  const batches=await mapLimit(intervals,async([start,end])=>{
    const query=`SELECT toDate(timestamp + INTERVAL '8' HOUR) AS date, blob1 AS event, blob2 AS document, blob6 AS user_hash, blob7 AS client_hash, argMin(timestamp,timestamp) AS first_seen, argMax(timestamp,timestamp) AS last_seen, COUNT(*) AS events, SUM(double3) AS no_match FROM events.analyticsEngine.thinkwithblack_marketing_telemetry_v1 WHERE timestamp >= $start AND timestamp < $end AND blob1 IN ('skill_search','skill_read') GROUP BY date,event,document,user_hash,client_hash LIMIT 10000`;
    sqls.push(query);const result=await env.ANALYTICS_SQL.query({query,params:{start,end}});if(!Array.isArray(result.data)||result.data.length>=10000)throw new Failure(502,'USAGE_TRUNCATED');return result.data;
  });
  const usage=batches.flat().map(r=>({...r,events:Number(r.events),no_match:Number(r.no_match),sampled_rows:null,max_sample_interval:null,first_seen:instant(r.first_seen),last_seen:instant(r.last_seen),platform:clientMap.get(r.client_hash)??'未辨識平台'}));
  const githubResponse=await fetcher('https://api.github.com/repos/backtrue/thinkwithblack-skills',{headers:{accept:'application/vnd.github+json','user-agent':'ThinkWithBlack-Dashboard'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!githubResponse.ok)throw new Failure(502,'GITHUB_UNAVAILABLE');const repo:any=await githubResponse.json();if(repo.full_name!=='backtrue/thinkwithblack-skills'||!Number.isFinite(repo.stargazers_count))throw new Failure(502,'GITHUB_INVALID');
  const github=[{observed_at:generatedAt,date:day(generatedAt),repository:repo.full_name,stars:repo.stargazers_count,forks:repo.forks_count,url:repo.html_url}];
  const source=(name:string,detail:string,extra:any={})=>({name,executedAt:generatedAt,classification:'observed',evidenceFlow:[{title:'來源讀取',detail}],...extra});
  const provenance={
    grants:source('MCP 現存授權','分頁讀取 OAUTH_KV grant:，僅保留授權及會員識別欄位',{coverage:'目前尚存的授權'}),
    members:source('ECCAL 會員對照','由 ECCAL 後端依 member_id 讀取目前 Email 與會員方案'),
    questions:source('使用者完整原始問題','分頁讀取問題 KV，逐筆重新核對 SHA-256',{coverage:'收錄功能啟用後成功保存的紀錄'}),
    usage:source('Skill 搜尋與讀取用量','Cloudflare Analytics SQL binding，89 天分段查詢；COUNT 與 SUM 由 API 自動套用取樣權重',{sql:sqls.join('\n\n'),coverage:`${intervals[0][0]} 至 ${generatedAt}；自動加權估計用量，會員為實際觀測識別`,links:[{label:'Cloudflare Analytics SQL 取樣定義',url:'https://developers.cloudflare.com/analytics/sql-api/datasets/#workers-analytics-engine-datasets'}]}),
    github:source('GitHub Skills 套件','GitHub 公開 repository API 即時讀取星數與 Fork'),
    traffic:prior?.provenance?.traffic??prior?.provenance?.github??source('GitHub traffic','尚無成功讀取快照'),
  };
  const daily={date:day(generatedAt),captured_at:generatedAt,stars:repo.stargazers_count,grant_members:users.length,grant_records:grants.length,question_records:questions.length};
  const history=[...(prior?.history??[]).filter((r:any)=>r.date!==daily.date),daily].sort((a:any,b:any)=>a.date.localeCompare(b.date));
  return {generatedAt,owner:{email:ownerEmail,user_hash:ownerHash,verified_at:generatedAt},grants,users,questions,usage,github,traffic:prior?.traffic??[],history,skillNames:prior?.skillNames??{},provenance};
}
export async function handle(request:Request,env:Env,fetcher:typeof fetch=fetch){
  try{
    const path=new URL(request.url).pathname;if(!['/snapshot','/refresh'].includes(path))return response({error:'NOT_FOUND'},404);
    if((path==='/snapshot'&&request.method!=='GET')||(path==='/refresh'&&request.method!=='POST'))return response({error:'METHOD_REJECTED'},405);
    const userId=await identity(request,fetcher);
    if(path==='/snapshot'){const cached=await env.DASHBOARD_KV.get('snapshot','json');if(!cached||cached.owner?.user_hash!==await sha(userId))throw new Failure(503,'SNAPSHOT_UNAVAILABLE');return response(cached);}
    const data=await collect(env,userId,fetcher);await env.DASHBOARD_KV.put('snapshot',JSON.stringify(data));return response(data);
  }catch(error){return response({error:error instanceof Failure?error.code:'SOURCE_UNAVAILABLE'},error instanceof Failure?error.status:502);}
}
export default {fetch:handle};
