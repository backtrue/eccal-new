import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { createVoiceLoginRepository } from './voiceLoginRepository';
import { setupVoiceLoginRoutes } from './voiceLoginRoutes';
import { setupVoiceQuotaRoutes, verifyVoiceJwt } from './voiceQuotaRoutes';
import { createVoiceQuotaService } from './voiceQuotaService';
import { createVoiceQuotaRepository } from './voiceQuotaRepository';
import { beginVoiceGoogleState, consumeVoiceGoogleState, completeVoiceLoginContext } from './voiceLoginState';

if (!process.env.REALTIME_BLACK_ROOT) throw new Error('REALTIME_BLACK_ROOT is required');
const root = process.env.REALTIME_BLACK_ROOT;
const { authRoutes } = await import(pathToFileURL(resolve(root, 'src/auth-routes.ts')).href);
const { HttpEccalQuota } = await import(pathToFileURL(resolve(root, 'src/eccal-http.ts')).href);
const origin = 'https://voice.example.test', key = Buffer.alloc(32, 9).toString('base64url'), jwtKey = 'fixture-login-jwt-key';
const schema = `test_voice_login_${randomUUID().replaceAll('-', '')}`;
const config = { host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' };
const admin = new pg.Pool({ ...config, max: 2 }), pool = new pg.Pool({ ...config, max: 10, options: `-c search_path=${schema}` });
const repository = createVoiceLoginRepository(pool);
const quotaService = createVoiceQuotaService({ repository: createVoiceQuotaRepository(pool), getUser: async id => (await pool.query('SELECT id FROM users WHERE id=$1', [id])).rows[0] });
const browserJwt = (id: string) => jwt.sign({ id, sub: id }, jwtKey, { expiresIn: 3600 });
const app = express();
setupVoiceLoginRoutes(app, { getKey: () => key, getAppOrigin: () => origin, repository: async () => repository, verifyJwt: async token => {
  const id = verifyVoiceJwt(token, jwtKey); const value = jwt.decode(token) as { exp: number } | null;
  return id && value ? { id, expiresAt: value.exp * 1000 } : null;
} });
setupVoiceQuotaRoutes(app, { getServiceToken: () => key, verifyJwt: token => verifyVoiceJwt(token, jwtKey), service: async () => quotaService, authenticateSession: token => repository.authenticate(token) });
app.use(cookieParser());
app.get('/api/auth/google', (_req, res) => {
  const state = beginVoiceGoogleState(res, key, true);
  res.redirect(302, `https://accounts.example.test/authorize?state=${encodeURIComponent(state)}`);
});
app.get('/api/auth/google/callback', (req, res) => {
  if (!consumeVoiceGoogleState(req, res, String(req.query.state), key, true)) { res.status(400).json({ error: 'LOGIN_STATE_INVALID' }); return; }
  const token = browserJwt('fixture-a');
  try { completeVoiceLoginContext(req, res, token, key, true); }
  catch { res.status(400).json({ error: 'LOGIN_STATE_INVALID' }); return; }
  res.cookie('auth_token', token, { httpOnly: true, secure: true, path: '/' });
  res.redirect(302, '/api/voice/login');
});
let server: ReturnType<typeof app.listen>, base: string;
const vault = () => ({ grant: async () => { throw Object.assign(new Error('MCP_AUTH_REQUIRED'), { code: 'MCP_AUTH_REQUIRED', status: 403 }); } });
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE users (id varchar PRIMARY KEY, email varchar)');
  for (const file of ['0004_voice_quotas.sql', '0005_voice_login.sql']) { const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'); await pool.query(sql); await pool.query(sql); }
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await pool.query('TRUNCATE voice_sessions,voice_login_codes,voice_reservations,voice_quotas,users');
  await pool.query("INSERT INTO users VALUES ('fixture-a','a@example.test'), ('fixture-b','b@example.test')");
});
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

class CookieJar {
  values = new Map<string, string>();
  apply(response: Response) {
    for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0], separator = first.indexOf('='); const name = first.slice(0, separator), value = first.slice(separator + 1); if (cookie.includes('Max-Age=0') || !value) this.values.delete(name); else this.values.set(name, value); }
  }
  header() { return Array.from(this.values, ([name, value]) => `${name}=${value}`).join('; '); }
}
const settings = () => ({ APP_ORIGIN: origin, ECCAL_ORIGIN: base, ECCAL_SERVICE_TOKEN: key });
const controller = (path: string, jar: CookieJar, init: RequestInit = {}) => authRoutes(new Request(new URL(path, origin), { ...init, headers: { Cookie: jar.header(), ...init.headers } }), settings(), vault);
const eccal = (path: string, jar: CookieJar) => fetch(new URL(path, base), { headers: { Cookie: jar.header() }, redirect: 'manual' });
async function begin(id?: string) {
  const browser = new CookieJar(), account = new CookieJar(); if (id) account.values.set('auth_token', browserJwt(id));
  const start = await controller('/auth/login', browser); browser.apply(start);
  const login = await eccal(start.headers.get('location')!, account); account.apply(login);
  assert.equal(login.status, 302);
  return { browser, account, clean: login.headers.get('location')! };
}
async function signedIn() {
  const flow = await begin('fixture-a'); const result = await eccal(flow.clean, flow.account); flow.account.apply(result);
  const callback = result.headers.get('location')!;
  const response = await controller(callback, flow.browser); flow.browser.apply(response);
  assert.equal(response.headers.get('location'), `${origin}/`);
  return { ...flow, callback, response };
}

test('跨repo登入從ECCAL一次性碼換成本站HttpOnly會話，兩邊憑證分離且資料庫只存雜湊', async () => {
  const f = await signedIn();
  const responseCookies = f.response.headers.getSetCookie();
  assert.ok(responseCookies.some(value => value.startsWith('__Host-realtime_session=') && value.includes('HttpOnly') && value.includes('Secure') && !value.includes('Domain=')));
  const sessionToken = f.browser.values.get('__Host-realtime_session')!; assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!f.browser.values.has('auth_token')); assert.ok(!f.callback.includes(f.account.values.get('auth_token')!));
  const client = new HttpEccalQuota(base, key);
  assert.deepEqual(await client.authenticate({ cookie: f.browser.header(), authorization: '' }), { memberId: 'fixture-a', eligible: true });
  assert.equal(await client.balance('fixture-a'), 300);
  const rows = JSON.stringify((await pool.query('SELECT row_to_json(s) FROM voice_sessions s')).rows);
  assert.ok(!rows.includes(sessionToken)); assert.ok(!rows.includes(f.account.values.get('auth_token')!));
  const reused = await controller(f.callback, f.browser); assert.equal(reused.headers.get('location'), `${origin}/?auth=login-failed`);
  assert.equal((await pool.query('SELECT * FROM voice_sessions')).rowCount, 1);
});
test('callback換瀏覽器時不交換code，原瀏覽器仍可完成登入', async () => {
  const f = await begin('fixture-a'); const result = await eccal(f.clean, f.account); const callback = result.headers.get('location')!;
  const attacker = new CookieJar(); attacker.values.set('__Host-realtime_login', randomBytes(32).toString('base64url'));
  assert.equal((await controller(callback, attacker)).headers.get('location'), `${origin}/?auth=login-failed`);
  assert.equal((await pool.query('SELECT consumed_at FROM voice_login_codes')).rows[0].consumed_at, null);
  assert.equal((await controller(callback, f.browser)).headers.get('location'), `${origin}/`);
});
test('ECCAL登入途中換成別人的JWT拒絕，防止舊登入回呼覆寫此次會員', async () => {
  const f = await begin('fixture-a'); f.account.values.set('auth_token', browserJwt('fixture-b'));
  const response = await eccal(f.clean, f.account); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'LOGIN_STATE_INVALID' });
  assert.equal((await pool.query('SELECT * FROM voice_login_codes')).rowCount, 0);
});
test('未登入時經綁定Google state回到ECCAL，再完成同一跨站登入', async () => {
  const f = await begin();
  const login = await eccal(f.clean, f.account); assert.equal(login.headers.get('location'), '/api/auth/google?returnTo=%2Fapi%2Fvoice%2Flogin');
  const google = await eccal(login.headers.get('location')!, f.account); f.account.apply(google);
  const state = new URL(google.headers.get('location')!).searchParams.get('state')!;
  const wrong = await eccal(`/api/auth/google/callback?state=${encodeURIComponent(state + 'x')}`, f.account); assert.equal(wrong.status, 400);
  const noCookie = new CookieJar(); assert.equal((await eccal(`/api/auth/google/callback?state=${encodeURIComponent(state)}`, noCookie)).status, 400);
  const completed = await eccal(`/api/auth/google/callback?state=${encodeURIComponent(state)}`, f.account); f.account.apply(completed); assert.equal(completed.status, 302);
  const code = await eccal(completed.headers.get('location')!, f.account);
  assert.equal((await controller(code.headers.get('location')!, f.browser)).headers.get('location'), `${origin}/`);
});
test('8個並行交換只建立一筆會話，code到期拒絕，session不超過原JWT期限', async () => {
  const expiresAt = Date.now() + 3600000;
  const code = await repository.createCode('fixture-a', 'fixture-state', origin, expiresAt);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => repository.exchange(code, 'fixture-state', origin)));
  const successful = results.filter(result => result.status === 'fulfilled'); assert.equal(successful.length, 1); assert.equal(successful[0].value.expiresAt, expiresAt);
  const expired = await repository.createCode('fixture-a', 'expired-state', origin, expiresAt);
  await pool.query("UPDATE voice_login_codes SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL");
  await assert.rejects(repository.exchange(expired, 'expired-state', origin), { code: 'LOGIN_CODE_INVALID' });
});
test('會話到期、登出與服務端撤銷後皆無法再讀會員資料，跨站登出拒絕', async () => {
  const f = await signedIn(), token = f.browser.values.get('__Host-realtime_session')!;
  await assert.rejects(controller('/auth/logout', f.browser, { method: 'POST', headers: { Origin: 'https://evil.example.test' } }), { code: 'ORIGIN_FORBIDDEN' });
  const loggedOut = await controller('/auth/logout', f.browser, { method: 'POST', headers: { Origin: origin } }); f.browser.apply(loggedOut);
  assert.deepEqual(await loggedOut.json(), { loggedOut: true }); assert.equal(await repository.authenticate(token), null);
  const code = await repository.createCode('fixture-a', 'later-state', origin, Date.now() + 3600000), session = await repository.exchange(code, 'later-state', origin);
  await pool.query("UPDATE voice_sessions SET expires_at=now()-interval '1 second'");
  assert.equal(await repository.authenticate(session.sessionToken), null);
});
test('MCP帳號核對只接受相同ECCAL會員的Email，拒絕額外欄位與錯服務憑證', async () => {
  const request = (body: unknown, authorization = `Bearer ${key}`) => fetch(base + '/api/voice/internal/login/mcp-identity', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) });
  assert.deepEqual(await (await request({ memberId: 'fixture-a', accountEmail: 'a@example.test' })).json(), { memberId: 'fixture-a', matches: true });
  assert.deepEqual(await (await request({ memberId: 'fixture-a', accountEmail: 'b@example.test' })).json(), { memberId: 'fixture-a', matches: false });
  const bad = await request({ memberId: 'fixture-a', accountEmail: 'a@example.test', matches: true }); assert.equal(bad.status, 400); await bad.json();
  const caller = await request({ memberId: 'fixture-a', accountEmail: 'a@example.test' }, 'Bearer wrong'); assert.equal(caller.status, 401); await caller.json();
});
test('Email大小寫正規化後仍有兩個帳號時拒絕綁定，不能以Email混用會員', async () => {
  await pool.query("INSERT INTO users VALUES ('fixture-case-alias','A@EXAMPLE.TEST')");
  assert.equal(await repository.matchesAccount('fixture-a', 'a@example.test'), false);
  assert.equal(await repository.matchesAccount('fixture-case-alias', 'A@EXAMPLE.TEST'), false);
});
