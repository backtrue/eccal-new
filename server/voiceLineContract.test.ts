import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createVoiceLineHarness } from './voiceLineTestHarness';

test('ECCAL LINE 真人核對經真實 HTTP、RPC、SQLite 完成雙會員與防護驗證', async t => {
  const h = await createVoiceLineHarness(); const report: any = { environment: 'Loopback ECCAL Express, native Workers RPC/SQLite, synthetic members and operator evidence', productionDataUsed: false, lineMessageSent: false, scenarios: [] };
  try {
    await t.test('營運管理者、服務呼叫者與 Origin 邊界', async () => {
      assert.equal((await h.admin('/api/tasks', undefined, '')).status, 401);
      assert.equal((await h.admin('/api/tasks', undefined, h.ownerCookie('fixture-b'))).status, 401);
      assert.equal((await fetch(h.loopback + '/api/voice/internal/line/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
      assert.equal((await h.admin('/api/prepare', {}, undefined, { origin: 'https://wrong.example.test' })).status, 403);
      assert.equal((await h.admin('/api/prepare', {}, undefined, { 'x-voice-line-action': 'wrong' })).status, 403);
      const page = await h.admin('/'); assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.ok(page.headers.get('content-security-policy')?.includes("script-src 'self'"));
      report.scenarios.push({ name: 'auth-and-origin', passed: true });
    });
    const lost = await h.create('a', true); assert.equal(lost.response.status, 201);
    const retry = await h.voice('/api/calls/' + lost.call.id + '/deliveries', 'a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lost.input) });
    const a = { response: retry, call: lost.call, ...await retry.json() }; const b = await h.create('b');
    await t.test('首次成功落盤但回應遺失，同一請求重送取得唯一可用領取碼', async () => {
      assert.equal(lost.lost, true); assert.equal(a.response.status, 201); assert.match(a.claimCode, /^[a-f0-9]{32}$/);
      const record = await (await h.voice('/api/calls/' + a.call.id)).json(); assert.equal(record.deliveries.length, 1); assert.equal(record.deliveries[0].id, a.job.id);
      const another = await h.voice('/api/calls/' + lost.call.id + '/deliveries', 'a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lost.input) }); const replay = await another.json(); assert.equal(replay.job.id, a.job.id); assert.equal(replay.claimCode, a.claimCode);
      report.scenarios.push({ name: 'lost-create-response-replay', passed: true });
    });
    await t.test('兩會員從實際會員路由建立 ECCAL 待辦及領取碼', async () => {
      assert.equal(a.response.status, 201, JSON.stringify({ error: a.error, diagnostics: h.diagnostics })); assert.equal(b.response.status, 201, JSON.stringify({ error: b.error, diagnostics: h.diagnostics })); assert.match(a.claimCode, /^[a-f0-9]{32}$/); assert.notEqual(a.claimCode, b.claimCode);
      const response = await h.admin('/api/tasks'); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.tasks.length, 2); assert.ok(data.tasks.every((task: any) => task.state === 'pending')); assert.equal(JSON.stringify(data).includes(a.claimCode), false); assert.equal(JSON.stringify(data).includes('claimDigest'), false);
      assert.deepEqual(h.outbound, ['/api/voice/internal/line/register', '/api/voice/internal/line/register']); report.scenarios.push({ name: 'two-member-register', passed: true });
    });
    const prep = (job: any, chatRef: string) => ({ jobId: job.job.id, claimCode: job.claimCode, observedChatRef: chatRef, chatRef, officialAccount: '@791vlxya', attemptId: randomUUID(), supervised: true });
    const pa = prep(a, 'controlled-chat-a'); const pb = prep(b, 'controlled-chat-b');
    await t.test('錯碼、錯聊天室、錯官方帳號不取得成果連結', async () => {
      const code = await h.admin('/api/prepare', { ...pa, claimCode: b.claimCode }); assert.equal(code.status, 403); assert.equal((await code.json()).error, 'CLAIM_INVALID');
      assert.equal((await h.admin('/api/prepare', { ...pa, chatRef: 'wrong-chat' })).status, 403);
      assert.equal((await h.admin('/api/prepare', { ...pa, officialAccount: '@wrong' })).status, 400);
      const list = await (await h.admin('/api/tasks')).json(); assert.ok(list.tasks.every((task: any) => task.state === 'pending' && task.resultUrl === undefined)); report.scenarios.push({ name: 'wrong-code-and-chat', passed: true });
    });
    const ca = { jobId: pa.jobId, attemptId: pa.attemptId, officialAccount: '@791vlxya', chatRef: pa.chatRef, outcome: 'sent', receipt: 'controlled LINE UI message-a', evidenceSha256: 'a'.repeat(64) };
    await t.test('正確核對、送出證據、核銷與重複請求', async () => {
      const response = await h.admin('/api/prepare', pa); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.state, 'sending'); assert.equal(data.resultUrl, h.appOrigin + '/#call=' + a.call.id + '&document=' + a.call.documentId);
      assert.equal((await h.admin('/api/complete', { ...ca, chatRef: 'wrong-chat' })).status, 403);
      assert.equal((await h.admin('/api/complete', { ...ca, evidenceSha256: undefined })).status, 400);
      const done = await h.admin('/api/complete', ca); assert.equal(done.status, 200); const completed = await done.json(); assert.equal(completed.state, 'succeeded'); assert.equal(completed.attempt.evidence.receipt, ca.receipt);
      assert.deepEqual(await (await h.admin('/api/complete', ca)).json(), completed);
      assert.equal((await h.admin('/api/prepare', { ...pa, attemptId: randomUUID() })).status, 409); assert.equal((await h.admin('/api/complete', { ...ca, receipt: 'changed' })).status, 409); report.scenarios.push({ name: 'confirm-and-single-use', passed: true });
    });
    await t.test('不明結果與傳送失敗不標成功，不能重複派送', async () => {
      assert.equal((await h.admin('/api/prepare', pb)).status, 200);
      const unknown = await (await h.admin('/api/complete', { jobId: pb.jobId, attemptId: pb.attemptId, officialAccount: '@791vlxya', chatRef: pb.chatRef, outcome: 'unknown', receipt: 'controlled result not confirmed' })).json(); assert.equal(unknown.state, 'unknown');
      assert.equal((await h.admin('/api/prepare', { ...pb, attemptId: randomUUID() })).status, 409);
      const rejected = await h.create('b'); const pr = prep(rejected, 'controlled-chat-b'); assert.equal((await h.admin('/api/prepare', pr)).status, 200);
      const failed = await (await h.admin('/api/complete', { jobId: pr.jobId, attemptId: pr.attemptId, officialAccount: '@791vlxya', chatRef: pr.chatRef, outcome: 'rejected', receipt: 'controlled LINE send failure' })).json(); assert.equal(failed.state, 'failed');
      report.scenarios.push({ name: 'failed-and-unknown', passed: true });
    });
    await t.test('成果仍限原會員，會員回應不含營運證據', async () => {
      assert.equal((await h.voice('/api/calls/' + a.call.id, 'b')).status, 404);
      const own = await h.voice('/api/calls/' + a.call.id, 'a'); assert.equal(own.status, 200); const raw = await own.text(); assert.equal(raw.includes('controlled LINE UI message-a'), false); assert.equal(raw.includes('controlled-chat-a'), false); assert.equal(raw.includes('lineAttempt'), false);
      assert.ok(h.outbound.every(path => path === '/api/voice/internal/line/register')); report.scenarios.push({ name: 'member-isolation-and-no-automatic-send', passed: true });
    });
    report.bundleSha256 = createHash('sha256').update(h.bundle).digest('hex'); report.passed = true;
  } finally { report.diagnostics = h.diagnostics; await h.dispose(); report.runtimeDisposed = true; report.loopbackServerClosed = true; if (process.env.VOICE_LINE_EVIDENCE) await writeFile(process.env.VOICE_LINE_EVIDENCE, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
});
