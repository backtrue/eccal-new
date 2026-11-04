import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import express from 'express';
import { setupVoiceLoginRoutes } from './voiceLoginRoutes';
import { createVoiceLoginRepository } from './voiceLoginRepository';

if (!process.env.REALTIME_BLACK_ROOT || !process.env.THINKWITHBLACK_MCP_ROOT) throw new Error('REALTIME_BLACK_ROOT and THINKWITHBLACK_MCP_ROOT are required');
const realtime = process.env.REALTIME_BLACK_ROOT, mcpRoot = process.env.THINKWITHBLACK_MCP_ROOT;
const load = (root: string, path: string) => import(pathToFileURL(resolve(root, path)).href);
const [{ McpOAuth, MCP_ISSUER, MCP_RESOURCE, MCP_SCOPES, READ_ONLY_TOOLS }, { ThinkWithBlackMcp }, { MemberAuthorization }, { HttpEccalQuota }, { decrypt, encrypt }, scopes, boundary] = await Promise.all([
  load(realtime, 'src/mcp-oauth.ts'), load(realtime, 'src/mcp.ts'), load(realtime, 'src/member-authorization.ts'), load(realtime, 'src/eccal-http.ts'), load(realtime, 'src/auth-crypto.ts'), load(mcpRoot, 'src/oauth/state.ts'), load(mcpRoot, 'src/mcp/methods-scope.ts'),
]);
const source = await readFile(resolve(mcpRoot, 'node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js'), 'utf8');
const executable = source.replace('import { WorkerEntrypoint } from "cloudflare:workers";', 'class WorkerEntrypoint {}');
if (executable === source) throw new Error('Provider entrypoint import not found');
const installed = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const values = new Map<string, string>();
const environment = { OAUTH_KV: {
  get: async (key: string, options?: { type?: string } | string) => { const value = values.get(key); return value === undefined ? null : (typeof options === 'string' ? options : options?.type) === 'json' ? JSON.parse(value) : value; },
  put: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); },
  list: async (options?: { prefix?: string }) => ({ keys: Array.from(values.keys()).filter(key => key.startsWith(options?.prefix ?? '')).map(name => ({ name })), list_complete: true, cacheStatus: null }),
} };
const options = { apiRoute: '/mcp', apiHandler: { fetch: async () => new Response(null, { status: 204 }) }, defaultHandler: { fetch: async () => new Response(null, { status: 404 }) }, authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', accessTokenTTL: 3600, refreshTokenTTL: 2592000, allowPlainPKCE: false, scopesSupported: Array.from(scopes.SUPPORTED_MCP_SCOPES), resourceMetadata: { resource: MCP_RESOURCE, authorization_servers: [MCP_ISSUER], scopes_supported: Array.from(scopes.SUPPORTED_MCP_SCOPES) } };
const helpers = installed.getOAuthApi(options, environment), provider = new installed.OAuthProvider(options);
const context = { waitUntil: (value: Promise<unknown>) => { void value.catch(() => {}); } };
const providerFetch: typeof fetch = async (input, init) => {
  const request = new Request(String(input), init);
  if (new URL(request.url).pathname !== '/mcp') return provider.fetch(request, environment, context);
  const token = request.headers.get('authorization')?.slice(7), summary = token ? await helpers.unwrapToken(token) : null;
  if (!summary || summary.expiresAt <= Date.now() / 1000) return new Response(null, { status: 401 });
  if (!await boundary.methodsHttpRequestAllowed(request)) return new Response(null, { status: 403 });
  const body = await request.json() as { id?: unknown; method: string; params?: { name?: string } }; let result: unknown;
  if (body.method === 'server/discover') result = { protocolVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'controlled-method-resource', version: '1' } };
  else if (body.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'controlled-method-resource', version: '1' } };
  else if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
  else if (body.method === 'tools/list') result = { tools: READ_ONLY_TOOLS.map((name: string) => ({ name, inputSchema: { type: 'object', properties: {} } })) };
  else result = body.params?.name === 'thinkwithblack_get_account_status' ? { content: [], structuredContent: { account_email: summary.userId === 'fixture-a' ? 'a@example.test' : 'b@example.test' } } : { content: [{ type: 'text', text: `method-for-${summary.userId}` }] };
  return Response.json({ jsonrpc: '2.0', id: body.id, result });
};

const key = Buffer.alloc(32, 9).toString('base64url'), appOrigin = 'https://voice.example.test';
const schema = `test_voice_mcp_${randomUUID().replaceAll('-', '')}`;
const pgConfig = { host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' };
const admin = new pg.Pool({ ...pgConfig, max: 2 }), pool = new pg.Pool({ ...pgConfig, max: 4, options: `-c search_path=${schema}` });
const app = express(); setupVoiceLoginRoutes(app, { getKey: () => key, getAppOrigin: () => appOrigin, repository: async () => createVoiceLoginRepository(pool) });
let server: ReturnType<typeof app.listen>, eccalOrigin: string, clientId: string;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); await pool.query("CREATE TABLE users(id varchar PRIMARY KEY,email varchar UNIQUE); INSERT INTO users VALUES ('fixture-a','a@example.test'),('fixture-b','b@example.test')");
  await pool.query(await readFile(new URL('../migrations/0005_voice_login.sql', import.meta.url), 'utf8'));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); eccalOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  clientId = (await helpers.createClient({ redirectUris: [`${appOrigin}/auth/mcp/callback`], clientName: 'Cross repo methods fixture', grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'], tokenEndpointAuthMethod: 'none' })).clientId;
});
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

function member(id: string) {
  const data = new Map<string, unknown>(), mcp = new ThinkWithBlackMcp(providerFetch), quota = new HttpEccalQuota(eccalOrigin, key);
  const store = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => { data.delete(key); }, list: async (prefix: string) => new Map(Array.from(data).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])), alarm: async () => {} };
  const auth = new MemberAuthorization({ store, secret: key, oauth: new McpOAuth(appOrigin, clientId, providerFetch), mcp, account: (grant: unknown) => mcp.account(grant), verifyAccount: (id: string, email: string) => quota.verifyMcpAccount(id, email) });
  const connect = async (providerId = id) => {
    const started = await auth.begin(id, 'fixture-session', 'fixture-browser'), url = new URL(started.url);
    const request = scopes.normalizeInitialMcpScopeRequest({ responseType: 'code', clientId, redirectUri: url.searchParams.get('redirect_uri'), scope: url.searchParams.get('scope')!.split(' '), state: url.searchParams.get('state'), codeChallenge: url.searchParams.get('code_challenge'), codeChallengeMethod: 'S256', resource: MCP_RESOURCE, issuer: MCP_ISSUER });
    assert.deepEqual(new Set(request.scope), new Set(MCP_SCOPES));
    const { redirectTo } = await helpers.completeAuthorization({ request, userId: providerId, metadata: {}, scope: request.scope, props: { userId: providerId }, revokeExistingGrants: false });
    const callback = new URL(redirectTo);
    return auth.complete(id, 'fixture-session', 'fixture-browser', { state: callback.searchParams.get('state')!, code: callback.searchParams.get('code')!, issuer: callback.searchParams.get('iss')! });
  };
  return { auth, data, mcp, connect };
}
test('三repo實際OAuth client、Provider與ECCAL帳號核對：兩會員隔離、換發及撤銷', async () => {
  const a = member('fixture-a'), b = member('fixture-b'); await a.connect(); await b.connect();
  const handle = await a.auth.grant('fixture-a'); assert.equal(handle.accessToken, undefined);
  assert.match(JSON.stringify(await a.auth.call('fixture-a', handle.authorizationId, READ_ONLY_TOOLS[0], {})), /method-for-fixture-a/);
  const other = await b.auth.grant('fixture-b'); assert.match(JSON.stringify(await b.auth.call('fixture-b', other.authorizationId, READ_ONLY_TOOLS[0], {})), /method-for-fixture-b/);
  const saved = a.data.get('grant') as { ciphertext: string; expiresAt: number }, credential = await decrypt(saved.ciphertext, key, 'fixture-a:grant');
  credential.expiresAt = 1; a.data.set('grant', { ...saved, ciphertext: await encrypt(credential, key, 'fixture-a:grant') });
  assert.equal((await a.auth.grant('fixture-a')).authorizationId, handle.authorizationId);
  const refreshed = await decrypt((a.data.get('grant') as { ciphertext: string }).ciphertext, key, 'fixture-a:grant');
  await assert.rejects(a.mcp.call({ memberId: 'fixture-a', accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt, readOnlyTools: ['gsc_query'] }, 'gsc_query', {}), { code: 'MCP_AUTH_REVOKED' });
  assert.deepEqual(await a.auth.revoke('fixture-a'), { pending: false }); assert.equal(await helpers.unwrapToken(refreshed.accessToken), null);
  await assert.rejects(a.auth.call('fixture-a', handle.authorizationId, READ_ONLY_TOOLS[0], {}), { code: 'MCP_AUTH_REQUIRED' });
  assert.ok(await b.auth.grant('fixture-b'));
});
test('實際Provider發給B的token不能綁到ECCAL會員A，並可撤銷錯帳號grant', async () => {
  const a = member('fixture-a'); await assert.rejects(a.connect('fixture-b'), { code: 'MCP_MEMBER_MISMATCH' });
  assert.equal(a.data.has('grant'), false); await a.auth.alarm(); assert.equal(Array.from(a.data.keys()).some(key => key.startsWith('revoke:')), false);
});
