import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import { setupVoiceQuotaRoutes, verifyVoiceJwt } from './voiceQuotaRoutes';
import { createVoiceQuotaRepository } from './voiceQuotaRepository';
import { createVoiceQuotaService } from './voiceQuotaService';

if (!process.env.REALTIME_BLACK_ROOT) throw new Error('REALTIME_BLACK_ROOT is required');
const source = process.env.REALTIME_BLACK_ROOT;
const { HttpEccalQuota } = await import(pathToFileURL(resolve(source, 'src/eccal-http.ts')).href);
const { MemberEngine } = await import(pathToFileURL(resolve(source, 'src/member-engine.ts')).href);
const schema = `test_voice_contract_${randomUUID().replaceAll('-', '')}`;
const config = { host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' };
const admin = new pg.Pool({ ...config, max: 2 });
const pool = new pg.Pool({ ...config, max: 6, options: `-c search_path=${schema}` });
const service = createVoiceQuotaService({ repository: createVoiceQuotaRepository(pool), getUser: async id => (await pool.query('SELECT id FROM users WHERE id=$1', [id])).rows[0] });
const key = Buffer.alloc(32, 9).toString('base64url');
const app = express();
setupVoiceQuotaRoutes(app, { getServiceToken: () => key, verifyJwt: token => verifyVoiceJwt(token, 'fixture-jwt-key'), service: async () => service });
let server: ReturnType<typeof app.listen>;
let origin: string;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query("CREATE TABLE users (id varchar PRIMARY KEY); INSERT INTO users VALUES ('fixture-a'), ('fixture-b')");
  await pool.query(await readFile(new URL('../migrations/0004_voice_quotas.sql', import.meta.url), 'utf8'));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
});

test('realtime-black live adapter與通話引擎經HTTP對上ECCAL真PostgreSQL帳目', async () => {
  const quota = new HttpEccalQuota(origin, key);
  const token = jwt.sign({ id: 'fixture-a', sub: 'fixture-a' }, 'fixture-jwt-key', { expiresIn: 60 });
  const identity = await quota.authenticate({ cookie: `auth_token=${token}`, authorization: '' });
  assert.deepEqual(identity, { memberId: 'fixture-a', eligible: true });
  assert.equal(await quota.balance('fixture-a'), 300);
  let now = Date.now(); const data = new Map<string, unknown>();
  const deps = {
    eccal: { authenticate: quota.authenticate.bind(quota), balance: quota.balance.bind(quota), reserve: quota.reserve.bind(quota), settle: quota.settle.bind(quota),
      mcpGrant: async () => { throw new Error('PERSONAL_MCP_OAUTH_MUST_NOT_BE_USED'); } },
    store: { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => { data.delete(key); }, list: async (prefix: string) => new Map(Array.from(data).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])), alarm: async () => {} },
    realtime: { create: async () => ({ callId: 'rtc_fixture', sdp: 'v=0\r\nfixture' }), hangup: async () => {} },
    mcp: { list: async () => [{ name: 'thinkwithblack_entry_catalog', description: 'fixture method', parameters: {} }], call: async () => { now += 30000; return { method: 'fixture-only' }; } },
    documents: { generate: async () => { throw new Error('unused'); } }, now: () => now, id: () => randomUUID(),
  };
  const engine = new MemberEngine(deps);
  const first = await engine.start(identity, randomUUID(), 'v=0\r\nfixture'); await engine.activate('fixture-a', first.id);
  await engine.ingest('fixture-a', first.id, { type: 'input_audio_buffer.speech_started' });
  now += 30000; const tool = await engine.tool('fixture-a', first.id, 'tool-1', 'thinkwithblack_entry_catalog', '{}'); now += 60000;
  assert.equal(JSON.parse(tool.output).ok, true);
  await engine.end('fixture-a', first.id);
  assert.equal(await quota.balance('fixture-a'), 210);
  assert.deepEqual((await engine.get('fixture-a', first.id)).settlement, { billedSeconds: 90, remainingSeconds: 210 });
  const second = await engine.start(identity, randomUUID(), 'v=0\r\nfixture'); await engine.activate('fixture-a', second.id);
  await engine.ingest('fixture-a', second.id, { type: 'output_audio_buffer.started' }); now += 210000;
  await engine.alarm();
  assert.equal(await new HttpEccalQuota(origin, key).balance('fixture-a'), 0);
  assert.equal(await quota.balance('fixture-b'), 300);
  await assert.rejects(engine.get('fixture-b', first.id), { code: 'RECORD_NOT_FOUND' });
  const rows = (await pool.query('SELECT billed_seconds,remaining_seconds FROM voice_reservations ORDER BY created_at')).rows;
  assert.deepEqual(rows, [{ billed_seconds: 90, remaining_seconds: 210 }, { billed_seconds: 210, remaining_seconds: 0 }]);
});
