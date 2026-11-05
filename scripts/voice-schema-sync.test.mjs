import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { databaseConnection, migrationSql, productionManifest, syncDevelopmentVoiceSchema, syncVoiceSchema, voiceTables } from './voice-schema-sync.mjs';

const names = ['development', 'production'].map(role => `test_eccal_voice_schema_${role}_${randomUUID().replaceAll('-', '')}`);
const urls = names.map(name => `postgresql://127.0.0.1:${process.env.VOICE_TEST_PG_PORT ?? 5432}/${name}`);
const admin = new pg.Client({ host: '127.0.0.1', port: Number(process.env.VOICE_TEST_PG_PORT ?? 5432), database: 'postgres' });
const clients = urls.map(connectionString => new pg.Client({ connectionString }));
let directory;
const config = () => ({ developmentUrl: urls[0], productionUrl: urls[1] });
test('Helium 內部連線保留原設定，外部連線維持 TLS 憑證驗證', () => {
  assert.equal(databaseConnection('postgresql://helium/fixture?sslmode=disable').ssl,false);
  assert.deepEqual(databaseConnection('postgresql://example.com/fixture?sslmode=disable').ssl,{rejectUnauthorized:true});
});
before(async () => {
  await admin.connect();
  for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
  for (const client of clients) { await client.connect(); await client.query("CREATE TABLE users(id varchar PRIMARY KEY); INSERT INTO users VALUES ('fixture-member'); CREATE TABLE existing_data(id integer PRIMARY KEY, value jsonb); INSERT INTO existing_data VALUES (1,'{\"original\":\"保留內容\"}'),(2,'{\"original\":true}')"); }
  await clients[1].query(await migrationSql());
  await clients[1].query("INSERT INTO voice_quotas VALUES ('fixture-member',300,120); INSERT INTO voice_sessions(token_hash,user_id,expires_at) VALUES (repeat('a',64),'fixture-member',now()+interval '1 hour')");
  directory = await mkdtemp(join(tmpdir(), 'eccal-voice-schema-'));
});
after(async () => {
  await Promise.all(clients.map(client => client.end()));
  for (const name of names) { assert.match(name,/^test_eccal_voice_schema_(development|production)_[a-f0-9]{32}$/); await admin.query(`DROP DATABASE IF EXISTS "${name}"`); }
  await admin.end(); if(directory) await rm(directory,{recursive:true,force:true});
});
test('只讀計畫指出四張缺表，兩個資料庫現有資料完全不變', async () => {
  const result = await syncVoiceSchema(config());
  assert.deepEqual(result.missingTables, voiceTables); assert.equal(result.applied,false);
  assert.equal((await clients[0].query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count,2);
  assert.deepEqual((await clients[1].query('SELECT * FROM voice_quotas')).rows,[{user_id:'fixture-member',granted_seconds:300,billed_seconds:120}]);
});
test('未備份不能套用，指向同一資料庫或pooler別名時拒絕', async () => {
  await assert.rejects(syncVoiceSchema({...config(),apply:true}),{code:'BACKUP_FILE_REQUIRED'});
  await assert.rejects(syncVoiceSchema({developmentUrl:urls[1],productionUrl:urls[1],apply:true}),{code:'SAME_DATABASE_FORBIDDEN'});
  await assert.rejects(syncVoiceSchema({developmentUrl:urls[1].replace('127.0.0.1','localhost'),productionUrl:urls[1],apply:true}),{code:'SAME_DATABASE_FORBIDDEN'});
  await assert.rejects(syncVoiceSchema({developmentUrl:'postgresql://example-pooler.neon.tech/app',productionUrl:'postgresql://example.neon.tech/app',apply:true}),{code:'SAME_DATABASE_FORBIDDEN'});
});
test('套用後結構不符時 rollback，新增表全部撤回且原有資料保留', async () => {
  await clients[1].query('ALTER TABLE voice_sessions ADD COLUMN expected_extra text');
  try {
    await assert.rejects(syncVoiceSchema({...config(),apply:true,backupFile:join(directory,'rollback-backup.json')}),{code:'RESULTING_SCHEMA_MISMATCH'});
    for(const table of voiceTables)assert.equal((await clients[0].query('SELECT to_regclass($1) AS relation',[`public.${table}`])).rows[0].relation,null);
    assert.deepEqual((await clients[0].query('SELECT value FROM existing_data ORDER BY id')).rows,[{value:{original:'保留內容'}},{value:{original:true}}]);
  } finally { await clients[1].query('ALTER TABLE voice_sessions DROP COLUMN expected_extra'); }
});
test('只補四張開發表，正式資料與原有開發資料不變，備份可讀回', async () => {
  const backupFile=join(directory,'backup.json');
  const result=await syncVoiceSchema({...config(),apply:true,backupFile});
  assert.equal(result.applied,true); assert.equal(result.productionReadOnly,true); assert.equal(result.productionDataUnchanged,true); assert.equal(result.existingDevelopmentDataUnchanged,true);
  assert.equal((await stat(backupFile)).mode&0o077,0);
  const backup=JSON.parse(await readFile(backupFile,'utf8')); assert.deepEqual(backup.productionVoiceRows.voice_quotas,[{user_id:'fixture-member',granted_seconds:300,billed_seconds:120}]);
  for(const client of clients)assert.deepEqual((await client.query('SELECT value FROM existing_data ORDER BY id')).rows,[{value:{original:'保留內容'}},{value:{original:true}}]);
  for(const table of voiceTables)assert.equal((await clients[0].query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,0);
  const repeat=await syncVoiceSchema({...config(),apply:true}); assert.deepEqual(repeat.missingTables,[]);assert.equal(repeat.applied,false);
});
test('既有開發表不相容時拒絕，保留原表及原資料', async () => {
  await clients[0].query('ALTER TABLE voice_sessions ADD COLUMN keep_existing text');
  await assert.rejects(syncVoiceSchema({...config(),apply:true,backupFile:join(directory,'mismatch.json')}),{code:'EXISTING_VOICE_SCHEMA_MISMATCH'});
  assert.equal((await clients[0].query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='voice_sessions' AND column_name='keep_existing'")).rows[0].count,1);
  await clients[0].query('ALTER TABLE voice_sessions DROP COLUMN keep_existing');
});
test('獨立開發庫模式核對正式結構摘要、備份及撤回，保留全部既有資料', async () => {
  const manifest=await productionManifest(urls[1]);
  assert.deepEqual(Object.keys(manifest.structureDigests),voiceTables);
  assert.equal(JSON.stringify(manifest).includes('fixture-member'),false);
  await assert.rejects(syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest:{...manifest,migrationSha256:'0'.repeat(64)},apply:true}),{code:'INVALID_PRODUCTION_MANIFEST'});
  await clients[0].query('DROP TABLE voice_reservations, voice_quotas, voice_login_codes, voice_sessions');
  const plan=await syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest});assert.deepEqual(plan.missingTables,voiceTables);
  await assert.rejects(syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest,apply:true}),{code:'BACKUP_FILE_REQUIRED'});
  const invalidManifest={...manifest,structureDigests:{...manifest.structureDigests,voice_sessions:'0'.repeat(64)}};
  await assert.rejects(syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest:invalidManifest,apply:true,backupFile:join(directory,'dev-rollback.json')}),{code:'RESULTING_SCHEMA_MISMATCH'});
  for(const table of voiceTables)assert.equal((await clients[0].query('SELECT to_regclass($1) AS relation',[`public.${table}`])).rows[0].relation,null);
  const backupFile=join(directory,'development-backup.json');
  const result=await syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest,apply:true,backupFile});
  assert.equal(result.applied,true);assert.equal(result.existingDevelopmentDataUnchanged,true);assert.equal((await stat(backupFile)).mode&0o077,0);
  assert.deepEqual((await clients[0].query('SELECT value FROM existing_data ORDER BY id')).rows,[{value:{original:'保留內容'}},{value:{original:true}}]);
  assert.equal((await syncDevelopmentVoiceSchema({developmentUrl:urls[0],manifest,apply:true})).applied,false);
});
