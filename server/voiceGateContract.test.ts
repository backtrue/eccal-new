import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import { setupVoiceQuotaRoutes, verifyVoiceJwt } from './voiceQuotaRoutes';
import { createVoiceQuotaRepository } from './voiceQuotaRepository';
import { createVoiceQuotaService } from './voiceQuotaService';

const root = process.env.REALTIME_BLACK_ROOT;
if (!root) throw new Error('REALTIME_BLACK_ROOT is required');
const voiceRequire = createRequire(resolve(root, 'package.json'));
const { build } = voiceRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = voiceRequire('miniflare');
const schema = `test_voice_gate_${randomUUID().replaceAll('-', '')}`;
const config = { host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' };
const admin = new pg.Pool({ ...config, max: 2 });
const pool = new pg.Pool({ ...config, max: 8, options: `-c search_path=${schema}` });
const repository = createVoiceQuotaRepository(pool);
const service = createVoiceQuotaService({ repository, getUser: async id => (await pool.query('SELECT id FROM users WHERE id=$1', [id])).rows[0] });
const key = Buffer.alloc(32, 9).toString('base64url'), jwtKey = 'controlled-gate-jwt-key';
const token = (id: string, expiresIn = 60) => jwt.sign({ id, sub: id, nonce: randomUUID() }, jwtKey, { expiresIn });
const app = express();
setupVoiceQuotaRoutes(app, { getServiceToken: () => key, verifyJwt: value => verifyVoiceJwt(value, jwtKey), service: async () => ({ ...service, identity: async id => {
  const identity = await service.identity(id);
  return id === 'fixture-ineligible' ? { ...identity, eligible: false } : identity;
} }) });
let server: ReturnType<typeof app.listen>, eccalOrigin: string, runtime: any, providerCreates = 0, providerEnds = 0;
const appOrigin = 'https://voice-gate.example.test';
const eccalBridgeOrigin = 'https://eccal-gate.example.test';
const gate = randomUUID();
const report: any = { observedAt: new Date().toISOString(), environment: 'Actual ECCAL Express routes and PostgreSQL; actual voice HTTP, MemberRoom queue and native Workers SQLite; controlled method definitions, provider and audio events', productionMemberUsed: false, productionQuotaUsed: false, externalProviderCalled: false, cases: [] };
const events = (seconds: number) => [{ id: 'reserved', type: 'reserved', at: 0 }, { id: 'connected', type: 'connected', at: 0 }, { id: 'ended', type: 'ended', at: seconds * 1000 }];
const request = (path: string, cookie = '', init: any = {}) => runtime.dispatchFetch(appOrigin + path, { ...init, headers: { 'x-test-gate': gate, cookie, origin: appOrigin, ...init.headers } });
const start = (cookie: string, operationId = randomUUID(), suffix = '', headers = {}) => request('/api/calls' + suffix, cookie, { method: 'POST', headers: { 'content-type': 'application/sdp', 'idempotency-key': operationId, ...headers }, body: 'v=0\r\ncontrolled-offer' });

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query("CREATE TABLE users (id varchar PRIMARY KEY); INSERT INTO users VALUES ('fixture-a'),('fixture-b'),('fixture-zero'),('fixture-race'),('fixture-ineligible'),('fixture-deleted')");
  await pool.query(await readFile(new URL('../migrations/0004_voice_quotas.sql', import.meta.url), 'utf8'));
  const exhausted = await service.reserve('fixture-zero', randomUUID()); await service.settle('fixture-zero', exhausted.id, events(300));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  eccalOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    import worker, { MemberRoom } from './src/worker';
    import { HttpEccalQuota } from './src/eccal-http';
    import { hash } from './src/auth-crypto';
    const cutoffs={idFromName:v=>v,get:()=>({arm:async()=>{},cancel:async()=>{},updateDeadline:async()=>({ok:true,value:{updated:true}})})};
    const methods={list:async()=>['thinkwithblack_entry_catalog','thinkwithblack_entry_read','thinkwithblack_marketing_skill_search','thinkwithblack_marketing_skill_read'].map(name=>({name,description:'controlled method fixture',parameters:{type:'object'}})),call:async()=>({content:[]})};
    export class GateRoom extends MemberRoom {
      constructor(ctx,env){super(ctx,{...env,CUTOFFS:cutoffs,MCP_METHODS:methods});this.testNow=Date.now();this.engine.deps.now=()=>this.testNow;this.attach=async()=>{};}
      async tick(member,id,ms){return this.run(async()=>{await this.engine.ingest(member,id,{type:'input_audio_buffer.speech_started',event_id:'controlled-audio'});this.testNow+=ms;await this.engine.alarm();return true;});}
    }
    export default {async fetch(req,env){
      if(req.headers.get('x-test-gate')!==env.TEST_GATE)return new Response(null,{status:403});
      if(new URL(req.url).pathname==='/test/tick'){
        const identity=await new HttpEccalQuota(env.ECCAL_ORIGIN,env.ECCAL_SERVICE_TOKEN).authenticate({cookie:req.headers.get('cookie')||'',authorization:''});
        if(!identity)return new Response(null,{status:401});const input=await req.json();
        return Response.json(await env.MEMBERS.get(env.MEMBERS.idFromName(await hash(identity.memberId))).tick(identity.memberId,input.id,input.ms));
      }
      return worker.fetch(req,env);
    }};
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat','global_fetch_strictly_public'], durableObjects: { MEMBERS: { className: 'GateRoom', useSQLite: true } }, bindings: { TEST_GATE: gate, APP_ORIGIN: appOrigin, ECCAL_ORIGIN: eccalBridgeOrigin, ECCAL_SERVICE_TOKEN: key, OPENAI_API_KEY: 'controlled-provider-key', REALTIME_MODEL: 'controlled-model' }, outboundService: async (req: any) => {
    const url = new URL(req.url);
    if (url.origin === eccalBridgeOrigin) {
      const result = await fetch(eccalOrigin + url.pathname, { method: req.method, headers: { 'content-type': req.headers.get('content-type') ?? '', authorization: req.headers.get('authorization') ?? '' }, body: req.method === 'POST' ? Buffer.from(await req.arrayBuffer()) : undefined });
      const body = await result.arrayBuffer();
      report.bridge ??= [];
      report.bridge.push({path:url.pathname,status:result.status,contract:result.headers.get('x-voice-contract'),contentType:result.headers.get('content-type'),bytes:body.byteLength});
      return new RuntimeResponse(body, { status: result.status, headers: Object.fromEntries(result.headers) });
    }
    if (url.origin !== 'https://api.openai.com') throw new Error('UNEXPECTED_EXTERNAL_ORIGIN');
    if (url.pathname === '/v1/realtime/client_secrets') return new RuntimeResponse(JSON.stringify({ value: 'controlled-ephemeral', expires_at: Math.floor(Date.now()/1000)+10 }), { headers: { 'content-type':'application/json' } });
    if (url.pathname === '/v1/realtime/calls') { providerCreates++; return new RuntimeResponse('v=0\r\ncontrolled-answer', { status:201, headers:{location:`/v1/realtime/calls/rtc_controlled_${providerCreates}`} }); }
    if (url.pathname.endsWith('/hangup')) { providerEnds++; return new RuntimeResponse(null, {status:200}); }
    throw new Error('UNEXPECTED_PROVIDER_PATH');
  } }));
  await runtime.ready;
  report.voiceCommit = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.eccalBaseCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.bundleSha256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
  report.sourceSha256 = {};
  for (const [name, base] of [['src/worker.ts',root],['src/member-engine.ts',root],['src/eccal-http.ts',root],['server/voiceQuotaRoutes.ts',process.cwd()],['server/voiceQuotaService.ts',process.cwd()],['server/voiceQuotaRepository.ts',process.cwd()]] as const) report.sourceSha256[name] = createHash('sha256').update(await readFile(resolve(base,name))).digest('hex');
});

after(async () => {
  await runtime?.dispose();
  if (server) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  report.schemaRemoved = (await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',[schema])).rowCount === 0;
  await admin.end(); report.runtimeDisposed = true;
  if (process.env.VOICE_GATE_EVIDENCE) await writeFile(process.env.VOICE_GATE_EVIDENCE, JSON.stringify(report,null,2)+'\n');
});

test('實際 ECCAL 身分及權威餘額連到原生通話發證入口，拒絕失效與會員冒用', async () => {
  const deletedJwt = token('fixture-deleted'), deletedCookie = `auth_token=${deletedJwt}`;
  const beforeRemoval = await request('/api/me', deletedCookie);
  assert.equal(beforeRemoval.status, 200);
  assert.deepEqual(await beforeRemoval.json(), { eligible: true, remainingSeconds: 300 });
  const removal = await pool.query('DELETE FROM users WHERE id=$1', ['fixture-deleted']);
  assert.equal(removal.rowCount, 1);
  assert.equal(verifyVoiceJwt(deletedJwt, jwtKey), 'fixture-deleted');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const authentication = await fetch(eccalOrigin + '/api/voice/internal/authenticate', { method:'POST', headers, body:JSON.stringify({cookie:deletedCookie,authorization:''}) });
  assert.equal(authentication.status, 200); assert.equal(await authentication.json(), null);
  const unavailableBalance = await fetch(eccalOrigin + '/api/voice/internal/balance', { method:'POST', headers, body:JSON.stringify({memberId:'fixture-deleted'}) });
  assert.equal(unavailableBalance.status, 404); assert.deepEqual(await unavailableBalance.json(), {error:'MEMBER_NOT_FOUND'});
  report.membershipRemoval = {before:{memberStatus:beforeRemoval.status,eligible:true,remainingSeconds:300},removedRows:removal.rowCount,originalCredentialStillValid:true,after:{authenticateStatus:authentication.status,authenticateResult:null,balanceStatus:unavailableBalance.status,balanceError:'MEMBER_NOT_FOUND'},source:'Actual ECCAL membership lookup after removing only the isolated test member'};
  const cases = [
    { name:'anonymous', cookie:'', status:401, error:'LOGIN_REQUIRED' },
    { name:'expired-jwt', cookie:`auth_token=${token('fixture-a',-1)}`, status:401, error:'LOGIN_REQUIRED' },
    { name:'invalid-signature', cookie:`auth_token=${jwt.sign({id:'fixture-a'},'wrong-key',{expiresIn:60})}`, status:401, error:'LOGIN_REQUIRED' },
    { name:'deleted-member', cookie:deletedCookie, status:401, error:'LOGIN_REQUIRED' },
    { name:'zero-balance', cookie:`auth_token=${token('fixture-zero')}`, status:403, error:'QUOTA_EXHAUSTED' },
    { name:'controlled-ineligible-contract', cookie:`auth_token=${token('fixture-ineligible')}`, status:403, error:'MEMBER_INELIGIBLE' },
  ];
  for (const item of cases) {
    const beforeCreates = providerCreates, response = await start(item.cookie), body = await response.json();
    assert.equal(response.status,item.status,JSON.stringify(body)); assert.equal(body.error,item.error); assert.equal(providerCreates,beforeCreates);
    assert.equal(response.headers.get('cache-control'),'no-store'); assert.deepEqual(Object.keys(body),['error']);
    report.cases.push({name:item.name,status:response.status,error:body.error,providerCreated:false,credentialsReturned:false});
  }
  for (const forged of [false,true]) {
    const cookie = `auth_token=${token('fixture-a')}`, beforeCreates=providerCreates;
    const response = await start(cookie,randomUUID(),forged?'?memberId=fixture-b':'',forged?{'x-member-id':'fixture-b'}:{}), body=await response.json();
    assert.equal(response.status,201); assert.deepEqual(Object.keys(body).sort(),['deadline','id','sdp']); assert.equal(providerCreates,beforeCreates+1);
    const active=(await pool.query('SELECT user_id FROM voice_reservations WHERE settled_at IS NULL')).rows;
    assert.deepEqual(active,[{user_id:'fixture-a'}]); assert.equal((await service.balance('fixture-b')).remainingSeconds,300);
    const other=await request('/api/calls/'+body.id,`auth_token=${token('fixture-b')}`); assert.equal(other.status,404);
    const end=await request('/api/calls/'+body.id+'/end',cookie,{method:'POST'}); assert.equal(end.status,200);
    assert.equal((await service.balance('fixture-a')).remainingSeconds,300);
    report.cases.push({name:forged?'forged-member-query-and-header':'eligible-with-balance',status:response.status,providerCreated:true,reservationOwner:'A',otherMemberRecordStatus:other.status,otherMemberRemainingSeconds:300,noAudioBilledSeconds:0,publicFields:Object.keys(body).sort()});
  }
  assert.deepEqual(await service.identity('fixture-b'),{memberId:'fixture-b',eligible:true});
  report.eligibilityContract={existingEccalMembers:'eligible:true',actualUnqualifiedCase:'Previously eligible member removed from isolated users table; original JWT is still valid but actual ECCAL identity returns null and balance returns MEMBER_NOT_FOUND',controlledIneligibleResponseExercised:true,controlledResponseSource:'Additional test-only eligible:false guard after actual JWT and PostgreSQL membership verification',membershipRule:'Every existing ECCAL member retains 300 seconds; no paid-tier or new eligibility restriction'};
});

test('兩個獨立會員憑證同時搶最後1秒，開始與結束重送不重發或重扣', async () => {
  const previous=await service.reserve('fixture-race',randomUUID()); await service.settle('fixture-race',previous.id,events(299));
  const cookies=[`auth_token=${token('fixture-race')}`,`auth_token=${token('fixture-race')}`],operations=[randomUUID(),randomUUID()];
  const observed=await Promise.all(cookies.map(async(cookie,index)=>{const requestedAt=Date.now(),response=await start(cookie,operations[index]);return {requestedAt,completedAt:Date.now(),status:response.status,body:await response.json()};}));
  assert.deepEqual(observed.map(x=>x.status).sort(),[201,409]);
  const index=observed.findIndex(x=>x.status===201), winner=observed[index],cookie=cookies[index];
  const active=(await pool.query('SELECT reserved_seconds FROM voice_reservations WHERE settled_at IS NULL')).rows;assert.deepEqual(active,[{reserved_seconds:1}]);
  const replay=await start(cookie,operations[index]);assert.equal(replay.status,409);assert.equal((await replay.json()).error,'OPERATION_REPLAYED');
  const endsBefore=providerEnds;
  const tick=await request('/test/tick',cookie,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:winner.body.id,ms:1000})});assert.equal(tick.status,200);assert.equal((await tick.json()).ok,true);
  const repeatedEnds=await Promise.all([request('/api/calls/'+winner.body.id+'/end',cookie,{method:'POST'}),request('/api/calls/'+winner.body.id+'/end',cookies[1-index],{method:'POST'})]);
  for(const result of repeatedEnds){assert.equal(result.status,200);await result.json();}
  assert.equal(providerEnds,endsBefore+1);
  const balance=await service.balance('fixture-race');assert.deepEqual(balance,{memberId:'fixture-race',totalSeconds:300,billedSeconds:300,reservedSeconds:0,remainingSeconds:0});
  const ledger=(await pool.query('SELECT billed_seconds,remaining_seconds FROM voice_reservations WHERE user_id=$1 ORDER BY created_at',['fixture-race'])).rows;assert.deepEqual(ledger,[{billed_seconds:299,remaining_seconds:1},{billed_seconds:1,remaining_seconds:0}]);
  const exhausted=await start(cookie);assert.equal(exhausted.status,403);assert.equal((await exhausted.json()).error,'QUOTA_EXHAUSTED');
  report.race={independentSignedCredentials:2,clients:'Two native HTTP clients; physical-device test remains pending',requests:observed.map(x=>({requestedAt:x.requestedAt,completedAt:x.completedAt,status:x.status})),reservedSeconds:1,repeatStartStatus:replay.status,repeatEndStatuses:repeatedEnds.map(x=>x.status),providerEndCount:providerEnds-endsBefore,ledger,totalSeconds:balance.totalSeconds,billedSeconds:balance.billedSeconds,reservedAfterEnd:balance.reservedSeconds,remainingSeconds:balance.remainingSeconds,newStartStatus:exhausted.status};
});
