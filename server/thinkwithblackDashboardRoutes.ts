import express,{type Express,type Request,type Response} from 'express';
import jwt from 'jsonwebtoken';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assembleSnapshot,dashboardPrefix,dashboardApi,digest,type DashboardRepository} from './thinkwithblackDashboardService';
const origin='https://eccal.thinkwithblack.com';
const owner='backtrue@gmail.com';
type Member={id:string;email:string|null;membershipLevel?:string};
export type DashboardDependencies={getSecret:()=>string|undefined;getUser:(id:string)=>Promise<Member|undefined|null>;getMembers:(ids:string[])=>Promise<Member[]>;repository:DashboardRepository;sourceUrl:string;fetcher?:typeof fetch;templatePath?:string;now?:()=>number};
const loginHtml=`<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入 ThinkWithBlack 營運總覽</title><style>body{font-family:system-ui;background:#f6f7f9;display:grid;place-items:center;min-height:100vh;margin:0}main{background:white;padding:36px;border-radius:20px;border:1px solid #e4e7ed;margin:20px}h1{font-size:24px}p{color:#626978;line-height:1.8}a{display:block;background:#285fc4;color:white;padding:13px;text-align:center;text-decoration:none;border-radius:10px}</style><main><h1>ThinkWithBlack 營運總覽</h1><p>使用報數據的 Google 登入<br>僅限 backtrue@gmail.com 查看</p><a href="/api/auth/google?returnTo=%2Fbdmin%2Fthinkwithblack%2F">使用 Google 登入</a></main></html>`;
class Rejected extends Error {constructor(readonly status:number,readonly code:string){super(code)}}
export function createDashboardRouter(d:DashboardDependencies){
  const router=express.Router();const fetcher=d.fetcher??fetch;const now=d.now??Date.now;
  const maxAge=24*60*60*1000;let updating:Promise<{hash:string;body:string}>|null=null;
  async function member(req:Request){
    const secret=d.getSecret();if(!secret||secret==='your-super-secret-jwt-key-change-this-in-production')throw new Rejected(503,'LOGIN_UNAVAILABLE');
    const token=req.cookies?.auth_token;if(typeof token!=='string'||token.length>8192)throw new Rejected(401,'LOGIN_REQUIRED');
    let claims:jwt.JwtPayload;
    try{const value=jwt.verify(token,secret,{algorithms:['HS256']});if(typeof value==='string'||typeof value.id!=='string'||typeof value.email!=='string'||typeof value.exp!=='number')throw new Error();claims=value;}catch{throw new Rejected(401,'LOGIN_REQUIRED');}
    const u=await d.getUser(claims.id);if(!u||u.id!==claims.id||u.email?.trim().toLowerCase()!==owner||claims.email?.trim().toLowerCase()!==owner)throw new Rejected(403,'OWNER_REQUIRED');
    return {user:u,token};
  }
  async function cloud(path:string,token:string,method='GET'){
    let r:globalThis.Response;try{r=await fetcher(d.sourceUrl+path,{method,headers:{authorization:`Bearer ${token}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(90000)});}catch{throw new Rejected(502,'SOURCE_UNAVAILABLE');}
    if(!r.ok)throw new Rejected(r.status===401||r.status===403?r.status:502,'SOURCE_UNAVAILABLE');
    const reader=r.body?.getReader();if(!reader)throw new Rejected(502,'SOURCE_UNAVAILABLE');const parts:Uint8Array[]=[];let bytes=0;
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>20*1024*1024){await reader.cancel();throw new Rejected(502,'SOURCE_TOO_LARGE');}parts.push(value);}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  async function capture(token:string,userId:string,supplied?:any){const raw=supplied??await cloud('/snapshot',token);if(raw.owner?.user_hash!==digest(userId))throw new Rejected(502,'SOURCE_IDENTITY_MISMATCH');const members=await d.getMembers(raw.users.map((u:any)=>String(u.member_id)));return d.repository.put(JSON.stringify(assembleSnapshot(raw,members,new Date().toISOString())));}
  async function refresh(token:string,userId:string){
    if(!updating)updating=(async()=>capture(token,userId,await cloud('/refresh',token,'POST')))().finally(()=>{updating=null;});
    return updating;
  }
  async function latest(token:string,userId:string){
    const record=await d.repository.latest();
    if(record){const generatedAt=Date.parse(JSON.parse(record.body).generatedAt);if(Number.isFinite(generatedAt)&&now()-generatedAt<maxAge&&generatedAt<=now())return record;}
    return refresh(token,userId);
  }
  const paths=[dashboardPrefix,dashboardPrefix+'/*',dashboardApi,dashboardApi+'/*'];
  router.use(paths,async(req,res)=>{
    res.set({'Cache-Control':'no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'});
    try{
      const pathname=new URL(req.originalUrl,origin).pathname;
      const {user,token}=await member(req);
      if(pathname===dashboardApi+'/refresh'){
        if(req.method!=='POST')throw new Rejected(405,'METHOD_REJECTED');
        if(req.get('origin')!==origin||req.get('x-dashboard-request')!=='refresh'||!req.is('application/json'))throw new Rejected(403,'REQUEST_REJECTED');
        const record=await refresh(token,user.id);res.json({status:'updated',generatedAt:JSON.parse(record.body).generatedAt});return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw new Rejected(405,'METHOD_REJECTED');
      if(pathname===dashboardApi+'/snapshot'){const record=await latest(token,user.id);res.type('application/json').send(req.method==='HEAD'?'':record.body);return;}
      const match=pathname.match(/^\/bdmin\/thinkwithblack\/snapshot\.([a-f0-9]{64})\.json$/);
      if(match){const record=await d.repository.get(match[1]);if(!record||digest(record.body)!==match[1])throw new Rejected(404,'SNAPSHOT_NOT_FOUND');res.type('application/json').send(req.method==='HEAD'?'':record.body);return;}
      if(pathname===dashboardPrefix){res.redirect(303,dashboardPrefix+'/');return;}
      if(pathname!==dashboardPrefix+'/'&&pathname!==dashboardPrefix+'/index.html')throw new Rejected(404,'NOT_FOUND');
      const record=await latest(token,user.id);if(digest(record.body)!==record.hash)throw new Rejected(502,'SNAPSHOT_INTEGRITY');
      const template=await readFile(d.templatePath??resolve(process.cwd(),'server/thinkwithblack-dashboard/index.html'),'utf8');
      const oldHash=template.match(/name="data-app-snapshot-sha256" content="([a-f0-9]{64})"/)?.[1];if(!oldHash)throw new Rejected(503,'DASHBOARD_UNAVAILABLE');
      const html=template.replaceAll(oldHash,record.hash);res.type('html').send(req.method==='HEAD'?'':html);
    }catch(e){const status=e instanceof Rejected?e.status:503;const code=e instanceof Rejected?e.code:'DASHBOARD_UNAVAILABLE';if(status===401&&req.method==='GET'&&[dashboardPrefix,dashboardPrefix+'/',dashboardPrefix+'/index.html'].includes(new URL(req.originalUrl,origin).pathname)){res.status(401).type('html').send(loginHtml);}else res.status(status).json({error:code});}
  });
  return router;
}
export function setupDashboardRoutes(app:Express,d:DashboardDependencies){app.use(createDashboardRouter(d));}
