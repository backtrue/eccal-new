import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createVoiceQuotaRepository } from './voiceQuotaRepository';
import { createVoiceQuotaService } from './voiceQuotaService';
import { setupVoiceQuotaRoutes, verifyVoiceJwt } from './voiceQuotaRoutes';
import { normalizeVoiceEvents, voiceBilledSeconds, VOICE_CONTRACT_VERSION, type VoiceMeterEvent } from '../shared/voiceQuota';

const schema = `test_voice_${randomUUID().replaceAll('-', '')}`;
const pgConfig = { host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' };
const admin = new pg.Pool({ ...pgConfig, max: 2 });
const pool = new pg.Pool({ ...pgConfig, max: 12, options: `-c search_path=${schema}` });
const repository = createVoiceQuotaRepository(pool);
const service = createVoiceQuotaService({ repository, getUser: async id => (await pool.query('SELECT id FROM users WHERE id=$1', [id])).rows[0] });
const event = (type: VoiceMeterEvent['type'], at: number, toolCallId?: string): VoiceMeterEvent => ({ id: `${type}:${at}:${toolCallId ?? ''}`, type, at, ...(toolCallId ? { toolCallId } : {}) });
const elapsed = (milliseconds: number): VoiceMeterEvent[] => [event('reserved', 0), event('connected', 0), event('ended', milliseconds)];

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE users (id varchar PRIMARY KEY, credits integer NOT NULL DEFAULT 7, membership_level text NOT NULL DEFAULT \'free\')');
  const migration = await readFile(new URL('../migrations/0004_voice_quotas.sql', import.meta.url), 'utf8');
  await pool.query(migration); await pool.query(migration);
});
beforeEach(async () => {
  await pool.query('TRUNCATE voice_reservations, voice_quotas, users');
  await pool.query("INSERT INTO users (id) VALUES ('fixture-a'),('fixture-b')");
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

test('每位現有會員各有300秒，查詢不建立或重發額度，點數及會員方案不變', async () => {
  for (const id of ['fixture-a', 'fixture-b']) assert.deepEqual(await service.balance(id), { memberId: id, totalSeconds: 300, billedSeconds: 0, reservedSeconds: 0, remainingSeconds: 300 });
  assert.equal((await pool.query('SELECT * FROM voice_quotas')).rowCount, 0);
  assert.deepEqual((await pool.query('SELECT credits,membership_level FROM users ORDER BY id')).rows, [{ credits: 7, membership_level: 'free' }, { credits: 7, membership_level: 'free' }]);
});
test('兩通120及180秒後為300、180、0，重新建立服務不重發，其他會員維持300', async () => {
  const first = await service.reserve('fixture-a', randomUUID());
  assert.equal(first.seconds, 300);
  assert.deepEqual(await service.settle('fixture-a', first.id, elapsed(120000)), { billedSeconds: 120, remainingSeconds: 180 });
  const restarted = createVoiceQuotaService({ repository: createVoiceQuotaRepository(pool), getUser: async id => ({ id }) });
  const second = await restarted.reserve('fixture-a', randomUUID()); assert.equal(second.seconds, 180);
  assert.deepEqual(await restarted.settle('fixture-a', second.id, elapsed(180000)), { billedSeconds: 180, remainingSeconds: 0 });
  await assert.rejects(service.reserve('fixture-a', randomUUID()), { code: 'QUOTA_EXHAUSTED' });
  assert.equal((await service.balance('fixture-b')).remainingSeconds, 300);
  assert.equal((await pool.query('SELECT credits FROM users WHERE id=$1', ['fixture-a'])).rows[0].credits, 7);
});
test('同一操作12個並行占用只產生同一筆與同一截止', async () => {
  const op = randomUUID(); const replies = await Promise.all(Array.from({ length: 12 }, () => service.reserve('fixture-a', op)));
  assert.equal(new Set(replies.map(reply => JSON.stringify(reply))).size, 1);
  assert.equal((await pool.query('SELECT * FROM voice_reservations')).rowCount, 1);
  const row = (await pool.query('SELECT created_at,deadline,reserved_seconds FROM voice_reservations')).rows[0];
  assert.equal(row.deadline.getTime() - row.created_at.getTime(), row.reserved_seconds * 1000);
  assert.equal((await service.balance('fixture-a')).remainingSeconds, 0);
});
test('最後1秒的多裝置不同操作只能成功占用一次', async () => {
  const first = await service.reserve('fixture-a', randomUUID()); await service.settle('fixture-a', first.id, elapsed(299000));
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.reserve('fixture-a', randomUUID())));
  const successes = results.filter(result => result.status === 'fulfilled'); assert.equal(successes.length, 1);
  assert.equal(successes[0].value.seconds, 1);
  for (const rejected of results.filter(result => result.status === 'rejected')) assert.equal(rejected.reason.code, 'RESERVATION_ACTIVE');
  assert.deepEqual(await service.settle('fixture-a', successes[0].value.id, elapsed(1000)), { billedSeconds: 1, remainingSeconds: 0 });
});
test('未接通為0秒、釋放占用，舊操作重播不改期限或重新占用', async () => {
  const op = randomUUID(); const call = await service.reserve('fixture-a', op);
  assert.deepEqual(await service.settle('fixture-a', call.id, [event('reserved', 0), event('ended', 5000)]), { billedSeconds: 0, remainingSeconds: 300 });
  assert.deepEqual(await service.reserve('fixture-a', op), call);
  assert.equal((await service.balance('fixture-a')).reservedSeconds, 0);
  assert.equal((await service.reserve('fixture-a', randomUUID())).seconds, 300);
});
test('90秒對話加30秒工具等待扣90秒，重疊等待排除一次', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  const events = [event('reserved', 0), event('connected', 0), event('tool_started', 30000, 't1'), event('tool_started', 40000, 't2'), event('tool_finished', 50000, 't1'), event('tool_finished', 60000, 't2'), event('ended', 120000)];
  assert.deepEqual(await service.settle('fixture-a', call.id, events), { billedSeconds: 90, remainingSeconds: 210 });
});
test('逐段不取整，0.4秒加0.4秒合計扣1秒；零長度工具不吃掉後續時間', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  const events = [event('reserved', 0), event('connected', 0), event('tool_started', 400, 't1'), event('tool_finished', 1000, 't1'), event('tool_started', 1200, 't2'), event('tool_finished', 1200, 't2'), event('ended', 1400)];
  assert.deepEqual(await service.settle('fixture-a', call.id, events), { billedSeconds: 1, remainingSeconds: 299 });
});
test('工具未回覆直到結束的等待不扣，斷線至確認結束仍計入', () => {
  assert.equal(voiceBilledSeconds(normalizeVoiceEvents([event('reserved', 0), event('connected', 0), event('tool_started', 1500, 't1'), event('ended', 9000)]), 300), 2);
  assert.equal(voiceBilledSeconds(normalizeVoiceEvents([event('reserved', 0), event('connected', 1000), event('disconnected', 5100), event('ended', 7100)]), 300), 7);
});
test('12次並行相同結算只扣一次，事件亂序及重複送達返回原收據', async () => {
  const call = await service.reserve('fixture-a', randomUUID()); const events = elapsed(1500);
  const replies = await Promise.all(Array.from({ length: 12 }, () => service.settle('fixture-a', call.id, events)));
  for (const reply of replies) assert.deepEqual(reply, { billedSeconds: 2, remainingSeconds: 298 });
  assert.deepEqual(await service.settle('fixture-a', call.id, [...events].reverse().concat(events[0])), replies[0]);
  assert.equal((await service.balance('fixture-a')).billedSeconds, 2);
});
test('已結算後修改時間軸拒絕，不覆寫帳目或原收據', async () => {
  const call = await service.reserve('fixture-a', randomUUID()); await service.settle('fixture-a', call.id, elapsed(1500));
  await assert.rejects(service.settle('fixture-a', call.id, elapsed(8000)), { code: 'SETTLEMENT_CONFLICT' });
  assert.equal((await service.balance('fixture-a')).billedSeconds, 2);
});
test('錯會員、未知占用及不存在會員拒絕，其他會員帳目不變', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  await assert.rejects(service.settle('fixture-b', call.id, elapsed(1000)), { code: 'RESERVATION_NOT_FOUND' });
  await assert.rejects(service.settle('fixture-a', randomUUID(), elapsed(1000)), { code: 'RESERVATION_NOT_FOUND' });
  await assert.rejects(service.reserve('missing', randomUUID()), { code: 'MEMBER_NOT_FOUND' });
  assert.equal((await service.balance('fixture-b')).remainingSeconds, 300);
});
test('無結束、衝突事件、未知欄位與失配工具時間軸拒絕', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  const bad = [elapsed(1000).slice(0, -1), [...elapsed(1000), { ...event('ended', 1000), at: 2000 }], [...elapsed(1000), { ...event('tool_started', 0, 't1'), audio: 'fixture-audio' }], [...elapsed(1000), event('tool_finished', 500, 'missing')], [event('reserved', 0), event('connected', 2000), event('ended', 1000)]];
  for (const events of bad) await assert.rejects(service.settle('fixture-a', call.id, events), { code: 'INVALID_METER_EVENTS' });
  assert.equal((await service.balance('fixture-a')).billedSeconds, 0);
});
test('帳目更新後寫收據失敗時整筆交易回復，占用保持且可重試', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  await pool.query("CREATE FUNCTION fail_voice_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-write-failure'; END $$");
  await pool.query('CREATE TRIGGER fail_receipt BEFORE UPDATE ON voice_reservations FOR EACH ROW EXECUTE FUNCTION fail_voice_receipt()');
  try { await assert.rejects(service.settle('fixture-a', call.id, elapsed(1000)), /fixture-write-failure/); }
  finally { await pool.query('DROP TRIGGER fail_receipt ON voice_reservations'); await pool.query('DROP FUNCTION fail_voice_receipt()'); }
  assert.equal((await service.balance('fixture-a')).billedSeconds, 0);
  assert.deepEqual(await service.settle('fixture-a', call.id, elapsed(1000)), { billedSeconds: 1, remainingSeconds: 299 });
});
test('資料庫拒絕重發額度、負數及未完成收據狀態', async () => {
  const call = await service.reserve('fixture-a', randomUUID());
  await assert.rejects(pool.query('UPDATE voice_quotas SET granted_seconds=600'), /check constraint/);
  await assert.rejects(pool.query('UPDATE voice_quotas SET billed_seconds=-1'), /check constraint/);
  await assert.rejects(pool.query('UPDATE voice_reservations SET settled_at=now() WHERE id=$1', [call.id]), /check constraint/);
  await assert.rejects(pool.query('INSERT INTO voice_quotas (user_id) VALUES ($1)', ['missing']), /foreign key/);
});

const serviceKey = Buffer.alloc(32, 9).toString('base64url');
const jwtKey = 'fixture-voice-jwt-secret';
async function httpFixture(configured = true) {
  const app = express();
  setupVoiceQuotaRoutes(app, { getServiceToken: () => configured ? serviceKey : undefined, verifyJwt: token => verifyVoiceJwt(token, jwtKey), service: async () => service });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/voice`;
  const request = async (path: string, body: unknown, authorization = `Bearer ${serviceKey}`) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  };
  return { base, request, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
test('HTTP驗證有效、過期、錯簽章及已刪除會員，回傳無權杖', async () => {
  const http = await httpFixture();
  try {
    const valid = jwt.sign({ id: 'fixture-a', sub: 'fixture-a' }, jwtKey, { expiresIn: 60 });
    const good = await http.request('/internal/authenticate', { cookie: `auth_token=${encodeURIComponent(valid)}`, authorization: '' });
    assert.deepEqual(good.body, { memberId: 'fixture-a', eligible: true });
    assert.equal(good.response.headers.get('cache-control'), 'no-store');
    assert.equal(good.response.headers.get('x-voice-contract'), VOICE_CONTRACT_VERSION);
    for (const token of [jwt.sign({ id: 'fixture-a' }, jwtKey, { expiresIn: -1 }), jwt.sign({ id: 'fixture-a' }, 'wrong', { expiresIn: 60 }), jwt.sign({ id: 'missing' }, jwtKey, { expiresIn: 60 }), jwt.sign({ id: 'fixture-a' }, jwtKey)]) {
      assert.equal((await http.request('/internal/authenticate', { cookie: '', authorization: `Bearer ${token}` })).body, null);
    }
    const own = await fetch(http.base + '/quota?memberId=fixture-b', { headers: { Cookie: `auth_token=${valid}` } });
    assert.equal((await own.json()).memberId, 'fixture-a');
    const missing = await fetch(http.base + '/quota'); assert.equal(missing.status, 401); await missing.json();
  } finally { await http.close(); }
});
test('HTTP後端介面可查詢占用結算，拒絕額度注入、錯服務權杖及額外欄位', async () => {
  const http = await httpFixture();
  try {
    assert.equal((await http.request('/internal/balance', { memberId: 'fixture-a' })).body.remainingSeconds, 300);
    const call = (await http.request('/internal/reserve', { memberId: 'fixture-a', operationId: randomUUID() })).body;
    const settled = await http.request('/internal/settle', { memberId: 'fixture-a', reservationId: call.id, events: elapsed(1500) });
    assert.deepEqual(settled.body, { billedSeconds: 2, remainingSeconds: 298 });
    assert.equal((await http.request('/internal/reserve', { memberId: 'fixture-a', operationId: randomUUID(), seconds: 600 })).response.status, 400);
    assert.equal((await http.request('/internal/settle', { memberId: 'fixture-a', reservationId: call.id, events: elapsed(1500), billedSeconds: 0 })).response.status, 400);
    for (const token of ['', 'Bearer fixture', `Bearer ${Buffer.alloc(32, 8).toString('base64url')}`]) assert.equal((await http.request('/internal/balance', { memberId: 'fixture-a' }, token)).response.status, 401);
    const malformed = await fetch(http.base + '/internal/balance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` }, body: '{' });
    assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'INVALID_REQUEST' });
    const oversized = await http.request('/internal/authenticate', { cookie: 'x'.repeat(300000), authorization: '' });
    assert.equal(oversized.response.status, 413); assert.deepEqual(oversized.body, { error: 'REQUEST_TOO_LARGE' });
  } finally { await http.close(); }
});
test('未設定服務權杖的介面拒絕使用', async () => {
  const http = await httpFixture(false);
  try { const reply = await http.request('/internal/balance', { memberId: 'fixture-a' }); assert.equal(reply.response.status, 503); assert.deepEqual(reply.body, { error: 'VOICE_NOT_CONFIGURED' }); }
  finally { await http.close(); }
});
