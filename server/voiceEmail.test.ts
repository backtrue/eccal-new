import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import express from 'express';
import { setupVoiceQuotaRoutes } from './voiceQuotaRoutes';
import { createVoiceQuotaRepository } from './voiceQuotaRepository';
import { createVoiceQuotaService } from './voiceQuotaService';
import { setupVoiceEmailRoutes } from './voiceEmailRoutes';
import { createVoiceEmailService, VOICE_EMAIL_FROM } from './voiceEmailService';

if (!process.env.REALTIME_BLACK_ROOT) throw new Error('REALTIME_BLACK_ROOT is required');
const root=process.env.REALTIME_BLACK_ROOT;
const {HttpEccalQuota}=await import(pathToFileURL(resolve(root,'src/eccal-http.ts')).href);
const {HttpEccalEmail}=await import(pathToFileURL(resolve(root,'src/email.ts')).href);
const {MemberEngine}=await import(pathToFileURL(resolve(root,'src/member-engine.ts')).href);
const schema=`test_voice_email_${randomUUID().replaceAll('-','')}`;
const config={host:'127.0.0.1',port:Number(process.env.VOICE_TEST_PG_PORT??5432),database:'postgres'};
const admin=new pg.Pool({...config,max:2});
const pool=new pg.Pool({...config,max:4,options:`-c search_path=${schema}`});
const key=Buffer.alloc(32,9).toString('base64url');
let now=Date.now(), mode='sent', configured=true;
const receipt=randomUUID();
const providerRequests:Array<{url:string;init:RequestInit}> = [];
const email=createVoiceEmailService({getUser:async id=>(await pool.query('SELECT id,email FROM users WHERE id=$1',[id])).rows[0],getApiKey:()=>configured?'fixture-provider-key':undefined,getAppOrigin:()=> 'https://fixture.invalid',now:()=>now,
  fetch:(async(url,init)=>{providerRequests.push({url:String(url),init:init!});if(mode==='network')throw new Error('fixture-private-network-detail');if(mode==='malformed')return Response.json({id:'-'.repeat(36)});if(mode==='rejected')return Response.json({private:'fixture-private-provider-detail'},{status:422});if(mode==='server')return Response.json({private:'fixture-private-provider-detail'},{status:503});return Response.json({id:receipt});}) as typeof fetch});
const quota=createVoiceQuotaService({repository:createVoiceQuotaRepository(pool),getUser:async id=>(await pool.query('SELECT id FROM users WHERE id=$1',[id])).rows[0]});
const app=express();
setupVoiceEmailRoutes(app,{getServiceToken:()=>key,service:async()=>email});
setupVoiceQuotaRoutes(app,{getServiceToken:()=>key,service:async()=>quota,verifyJwt:token=>token==='fixture-a'?'fixture-a':null});
let server:ReturnType<typeof app.listen>, origin:string;
before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query("CREATE TABLE users(id varchar PRIMARY KEY,email varchar); INSERT INTO users VALUES ('fixture-a','member-a@example.invalid'),('fixture-b','member-b@example.invalid')");
  await pool.query(await readFile(new URL('../migrations/0004_voice_quotas.sql',import.meta.url),'utf8'));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
beforeEach(async()=>{await pool.query('TRUNCATE voice_reservations,voice_quotas');await pool.query("UPDATE users SET email=CASE id WHEN 'fixture-a' THEN 'member-a@example.invalid' ELSE 'member-b@example.invalid' END");now=Date.now();mode='sent';configured=true;providerRequests.length=0;});
after(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();assert.match(schema,/^test_voice_email_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
const request=async(action:string,body:unknown,token=key)=>{const response=await fetch(`${origin}/api/voice/internal/email/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return{response,body:await response.json()};};
const job=()=>({memberId:'fixture-a',jobId:randomUUID(),recordId:randomUUID(),documentId:randomUUID(),recipient:'member-a@example.invalid',createdAt:now});
async function prepared(){
  const http=new HttpEccalQuota(origin,key);const sender=new HttpEccalEmail(origin,key);const data=new Map<string,unknown>();
  const engine=new MemberEngine({eccal:{authenticate:http.authenticate.bind(http),balance:http.balance.bind(http),reserve:http.reserve.bind(http),settle:http.settle.bind(http),emailRecipient:http.emailRecipient.bind(http),mcpGrant:async()=>{throw new Error('unused');}},
    realtime:{create:async()=>({callId:'rtc_fixture',sdp:'v=0\r\nfixture'}),hangup:async()=>{}},mcp:{list:async()=>[{name:'thinkwithblack_entry_catalog',description:'fixture method',parameters:{}}],call:async()=>({})},documents:{generate:async(kind:string)=>({kind,title:'合成諮詢成果',findings:[{kind:'member',text:'合成會員內容',sourceIds:['u1']}]})},
    store:{get:async(key:string)=>structuredClone(data.get(key)),put:async(key:string,value:unknown)=>{data.set(key,structuredClone(value));},delete:async(key:string)=>{data.delete(key);},list:async(prefix:string)=>new Map([...data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)])),alarm:async()=>{}},delivery:sender,appOrigin:'https://fixture.invalid',id:randomUUID,now:()=>now});
  const call=await engine.start({memberId:'fixture-a',eligible:true},randomUUID(),'v=0\r\nfixture');await engine.activate('fixture-a',call.id);
  await engine.ingest('fixture-a',call.id,{type:'input_audio_buffer.speech_started'});await engine.ingest('fixture-a',call.id,{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'合成諮詢內容'});now+=1000;await engine.end('fixture-a',call.id);
  const document=await engine.document('fixture-a',call.id,'report');const created=await engine.requestDelivery('fixture-a',call.id,{documentId:document.id,channel:'email',recipient:'',operationId:randomUUID()});return{engine,call,document,created};
}
test('內部端點驗證服務身分、嚴格欄位與會員登入信箱，不寄到其他會員',async()=>{
  const denied=await request('recipient',{memberId:'fixture-a'},'wrong');assert.equal(denied.response.status,401);assert.equal(denied.response.headers.get('cache-control'),'no-store');
  assert.equal((await request('recipient',{memberId:'fixture-a',recipient:'other@example.invalid'})).response.status,400);
  assert.deepEqual((await request('recipient',{memberId:'fixture-a'})).body,{memberId:'fixture-a',recipient:'member-a@example.invalid'});
  assert.equal((await request('recipient',{memberId:'missing'})).response.status,404);
  const input={...job(),recipient:'member-b@example.invalid'};
  assert.equal((await request('verify',input)).response.status,403);
  const rejected=await request('send',{...input,resultUrl:`https://fixture.invalid/#call=${input.recordId}&document=${input.documentId}`});assert.equal(rejected.body.outcome,'rejected');assert.equal(providerRequests.length,0);
});
test('真實 HTTP／PostgreSQL 與語音引擎只寄登入信箱，保存收據且重送不重寄',async()=>{
  const f=await prepared();assert.equal(f.created.job.recipient,'member-a@example.invalid');
  await assert.rejects(f.engine.requestDelivery('fixture-a',f.call.id,{documentId:f.document.id,channel:'email',recipient:'member-b@example.invalid',operationId:randomUUID()}),{code:'RECIPIENT_UNVERIFIED'});
  await assert.rejects(f.engine.sendEmail('fixture-b',f.call.id,f.created.job.id),{code:'RECORD_NOT_FOUND'});
  const result=await f.engine.sendEmail('fixture-a',f.call.id,f.created.job.id);assert.equal(result.state,'succeeded');assert.equal(result.providerReceipt,receipt);
  assert.equal((await f.engine.sendEmail('fixture-a',f.call.id,f.created.job.id)).state,'succeeded');assert.equal(providerRequests.length,1);
  const sent=providerRequests[0]!;assert.equal(sent.url,'https://api.resend.com/emails');assert.equal(sent.init.redirect,'manual');assert.ok(sent.init.signal);assert.equal(new Headers(sent.init.headers).get('idempotency-key'),`voice-result/${f.created.job.id}`);
  const body=JSON.parse(String(sent.init.body));assert.equal(body.from,VOICE_EMAIL_FROM);assert.deepEqual(body.to,['member-a@example.invalid']);assert.ok(body.text.includes(`https://fixture.invalid/#call=${f.call.id}&document=${f.document.id}`));assert.equal(JSON.stringify(body).includes(key),false);assert.equal(JSON.stringify(body).includes('fixture-provider-key'),false);
  assert.equal((await quota.balance('fixture-a')).billedSeconds,1);
});
for(const [providerMode,state,code,status]of[['rejected','failed','RESEND_REJECTED',422],['server','unknown','RESEND_UNAVAILABLE',503],['network','unknown','RESEND_UNAVAILABLE',undefined],['malformed','unknown','RESEND_UNAVAILABLE',undefined]] as const){
  test(`寄件回應 ${providerMode} 保存 ${state}，不標成功、不自動重送`,async()=>{mode=providerMode;const f=await prepared();const result=await f.engine.sendEmail('fixture-a',f.call.id,f.created.job.id);assert.equal(result.state,state);assert.equal(result.failureCode,code);assert.equal(result.providerStatus,status);assert.equal(result.providerReceipt,undefined);await f.engine.sendEmail('fixture-a',f.call.id,f.created.job.id);assert.equal(providerRequests.length,1);assert.equal(JSON.stringify(result).includes('fixture-private-'),false);});
}
test('寄送設定缺少時明確失敗，信箱變更、結果網址遭替換均不發送',async()=>{
  configured=false;const f=await prepared();const failed=await f.engine.sendEmail('fixture-a',f.call.id,f.created.job.id);assert.equal(failed.state,'failed');assert.equal(failed.failureCode,'EMAIL_NOT_CONFIGURED');assert.equal(providerRequests.length,0);
  configured=true;const input=job();const bad=await request('send',{...input,resultUrl:'https://foreign.invalid/'});assert.equal(bad.response.status,400);assert.equal(providerRequests.length,0);
  const second=await prepared();await pool.query("UPDATE users SET email='changed@example.invalid' WHERE id='fixture-a'");await assert.rejects(second.engine.sendEmail('fixture-a',second.call.id,second.created.job.id),{code:'RECIPIENT_UNVERIFIED'});assert.equal(providerRequests.length,0);
});
