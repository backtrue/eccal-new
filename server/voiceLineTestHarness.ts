import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setupVoiceLineRoutes } from './voiceLineRoutes';

export async function createVoiceLineHarness(preview = false) {
  const root = process.env.REALTIME_BLACK_ROOT;
  if (!root) throw new Error('REALTIME_BLACK_ROOT is required');
  const require = createRequire(resolve(root, 'package.json'));
  const { build } = require('esbuild'); const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = require('miniflare');
  const key = Buffer.alloc(32, 9).toString('base64url'); const gate = randomUUID(); const jwtKey = 'controlled-line-jwt-key';
  const appOrigin = 'https://voice-line.example.test'; const eccalOrigin = 'https://eccal-line.example.test';
  const users = new Map([['fixture-owner', { id: 'fixture-owner', email: 'backtrue@gmail.com' }], ['fixture-a', { id: 'fixture-a', email: 'fixture-a@example.invalid' }], ['fixture-b', { id: 'fixture-b', email: 'fixture-b@example.invalid' }]]);
  let runtime: any; let loopback = ''; let assetRoot: string | undefined;
  const diagnostics: Array<{ stage: string; action: string; status: number; error?: string; contract?: string | null; contentType?: string | null; registered?: unknown }> = [];
  if (preview) {
    assetRoot = await mkdtemp(resolve(tmpdir(), 'voice-line-preview-'));
    for (const file of ['index.html', 'app.js', 'style.css']) {
      let text = await readFile(resolve(process.cwd(), 'server/voice-line', file), 'utf8');
      if (file === 'index.html') text = text.replace('<body><main>', '<body><main><p>本機合成資料預覽</p>').replace('https://chat.line.biz/account/@791vlxya', '#');
      await writeFile(resolve(assetRoot, file), text);
    }
  }
  const app = express();
  if (preview) app.use((req, _res, next) => {
    if (req.get('origin') === loopback) req.headers.origin = 'https://eccal.thinkwithblack.com';
    const cookies = (req.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('voice_line_preview='));
    if (cookies.length === 1 && (req.path === '/bdmin/voice-line' || req.path.startsWith('/bdmin/voice-line/'))) req.headers.cookie = 'auth_token=' + cookies[0].slice('voice_line_preview='.length);
    next();
  });
  setupVoiceLineRoutes(app, { getServiceToken: () => key, getJwtSecret: () => jwtKey, getAppOrigin: () => appOrigin, getUser: async id => users.get(id), assetRoot, fetcher: async (url, init) => {
    const response = await runtime.dispatchFetch(String(url), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-test-gate': gate } });
    const data = await response.clone().json() as { error?: string; registered?: unknown };
    diagnostics.push({ stage: 'voice-internal', action: String(url).split('/').at(-1)!, status: response.status, error: data.error, registered: data.registered, contract: response.headers.get('x-voice-line-contract'), contentType: response.headers.get('content-type') });
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  loopback = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const code = `
    import worker, {MemberRoom} from './src/worker';
    const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    export class LineRoom extends MemberRoom {
      async seed(memberId){const id=crypto.randomUUID(),documentId=crypto.randomUUID(),now=Date.now();await this.ctx.storage.put('call:'+id,{id,memberId,operationId:crypto.randomUUID(),reservation:{id:crypto.randomUUID(),memberId,seconds:300,deadline:now+300000},status:'ended',events:[],transcript:[{itemId:'fixture-question',role:'user',text:'合成轉換率問題',at:now-1000}],itemOrder:[],pendingTranscripts:[],transcriptionFailures:[],transcriptRevision:0,tools:[],toolResults:{},settlement:{billedSeconds:0,remainingSeconds:300},createdAt:now-2000,endedAt:now,expiresAt:now+30*86400000,documents:[{id:documentId,kind:'report',title:'合成測試報告',findings:[],createdAt:now,sourceRevision:0}],deliveries:[]});return {id,documentId};}
    }
    export default {async fetch(req,env){if(req.headers.get('x-test-gate')!==env.TEST_GATE)return new Response(null,{status:403});
      if(new URL(req.url).pathname==='/__fixture/seed'){const {memberId}=await req.json();if(!['fixture-a','fixture-b'].includes(memberId))return new Response(null,{status:400});return Response.json(await env.MEMBERS.get(env.MEMBERS.idFromName(await hash(memberId))).seed(memberId));}
      const eccal={authenticate:async credentials=>{const id=credentials.cookie==='fixture=a'?'fixture-a':credentials.cookie==='fixture=b'?'fixture-b':null;return id?{memberId:id,eligible:true}:null;}};
      return worker.fetch(req,{...env,ECCAL:eccal});
    }};
  `;
  const bundle = await build({ stdin: { resolveDir: root, contents: code }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const outbound: string[] = [];
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], durableObjects: { MEMBERS: { className: 'LineRoom', useSQLite: true } }, bindings: { TEST_GATE: gate, APP_ORIGIN: appOrigin, ECCAL_ORIGIN: eccalOrigin, ECCAL_SERVICE_TOKEN: key }, outboundService: async (request: any) => {
    const url = new URL(request.url); if (url.origin !== eccalOrigin || url.pathname !== '/api/voice/internal/line/register') throw new Error('UNEXPECTED_EXTERNAL_REQUEST'); outbound.push(url.pathname);
    const response = await fetch(loopback + url.pathname, { method: request.method, headers: { authorization: request.headers.get('authorization') ?? '', 'content-type': request.headers.get('content-type') ?? '' }, body: Buffer.from(await request.arrayBuffer()) });
    const data = await response.clone().json() as { error?: string; registered?: unknown };
    diagnostics.push({ stage: 'eccal-register', action: 'register', status: response.status, error: data.error, registered: data.registered, contract: response.headers.get('x-voice-contract'), contentType: response.headers.get('content-type') });
    return new RuntimeResponse(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  } }));
  await runtime.ready;
  const ownerCookie = (id = 'fixture-owner') => 'auth_token=' + jwt.sign({ id, sub: id, email: users.get(id)!.email }, jwtKey, { expiresIn: 3600 });
  const voice = (path: string, member: 'a' | 'b' = 'a', init: any = {}) => runtime.dispatchFetch(appOrigin + path, { ...init, headers: { 'x-test-gate': gate, cookie: 'fixture=' + member, origin: appOrigin, ...init.headers } });
  const admin = (path: string, body?: unknown, cookie = ownerCookie(), extraHeaders: Record<string, string> = {}) => fetch(loopback + '/bdmin/voice-line' + path, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { origin: 'https://eccal.thinkwithblack.com', 'content-type': 'application/json', 'x-voice-line-action': path.slice('/api/'.length) } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const create = async (member: 'a' | 'b', loseResponse = false) => {
    const seed = await runtime.dispatchFetch(appOrigin + '/__fixture/seed', { method: 'POST', headers: { 'x-test-gate': gate, 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'fixture-' + member }) }); const call = await seed.json();
    const input = { documentId: call.documentId, channel: 'line', recipient: '', operationId: randomUUID() };
    const response = await voice('/api/calls/' + call.id + '/deliveries', member, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (loseResponse) { await response.body?.cancel(); return { response, call, input, lost: true }; }
    const result = await response.json(); return { response, call, input, ...result };
  };
  return { app, server, loopback, appOrigin, users, key, ownerCookie, voice, admin, create, outbound, diagnostics, assetRoot, bundle: bundle.outputFiles[0].text,
    async dispose() { await runtime.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (assetRoot) await rm(assetRoot, { recursive: true }); },
  };
}
