import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { handleText, jstDate } from '../src/bot.js';
import worker, { verifySignature } from '../src/index.js';

// Cloudflare D1 と同じ呼び方ができる最小の代用品
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      let args = [];
      const stmt = db.prepare(sql);
      return {
        bind(...a) { args = a; return this; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { stmt.run(...args); return { success: true }; },
      };
    },
  };
}

const NOW = new Date('2026-10-16T13:00:00Z'); // 日本時間 22:00

test('jstDate は日本時間の日付', () => {
  assert.equal(jstDate(new Date('2026-10-16T15:30:00Z')), '2026-10-17');
});

test('記録して今日・ベスト・取り消し', async () => {
  const db = fakeD1();
  let r = await handleText(db, 'U1', 'ベンチ60kg×8回', NOW);
  assert.match(r, /✅ ベンチプレス 60kg×8回×1セット/);
  assert.match(r, /推定1RM 76kg/);
  assert.doesNotMatch(r, /更新/);

  r = await handleText(db, 'U1', 'ベンチ 65 5', NOW);
  assert.match(r, /最大重量を更新/);

  r = await handleText(db, 'U1', 'スクワット 80 5 3セット\n懸垂 10回 3セット\nあいう', NOW);
  assert.match(r, /スクワット 80kg×5回×3セット/);
  assert.match(r, /懸垂 自重×10回×3セット/);
  assert.match(r, /⚠️ 「あいう」/);

  r = await handleText(db, 'U1', '今日', NOW);
  assert.match(r, /今日 10\/16\(金\)/);
  assert.match(r, /総挙上量 2,005kg/);

  r = await handleText(db, 'U1', 'ベスト', NOW);
  assert.match(r, /ベンチプレス 65kg/);
  assert.match(r, /懸垂 自重 10回/);

  r = await handleText(db, 'U1', '取り消し', NOW);
  assert.match(r, /取り消しました: 懸垂/);

  // 他のユーザーには見えない
  r = await handleText(db, 'U2', '履歴', NOW);
  assert.match(r, /まだ記録がありません/);
});

test('読めない入力はエラーとヘルプ案内', async () => {
  const r = await handleText(fakeD1(), 'U1', 'こんにちは', NOW);
  assert.match(r, /⚠️/);
  assert.match(r, /ヘルプ/);
});

test('署名チェック', async () => {
  const body = '{"events":[]}';
  const sig = createHmac('sha256', 'secret').update(body).digest('base64');
  assert.equal(await verifySignature(body, sig, 'secret'), true);
  assert.equal(await verifySignature(body, sig, 'other'), false);
  assert.equal(await verifySignature(body, null, 'secret'), false);
  assert.equal(await verifySignature(body, '@@@', 'secret'), false);
});

test('Webhook: 署名NGは401、OKなら返信APIを呼ぶ', async () => {
  const env = { DB: fakeD1(), LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 't' };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); };
  try {
    const body = JSON.stringify({ events: [{
      type: 'message', replyToken: 'R', source: { userId: 'U1' }, message: { type: 'text', text: 'ベンチ60kg×8回' },
    }] });
    const req = (sig) => new Request('https://x/webhook', { method: 'POST', body, headers: { 'x-line-signature': sig } });

    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    assert.equal((await worker.fetch(req('bad'), env, ctx)).status, 401);

    const sig = createHmac('sha256', 's').update(body).digest('base64');
    assert.equal((await worker.fetch(req(sig), env, ctx)).status, 200);
    await Promise.all(waits);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.replyToken, 'R');
    assert.match(sent[0].body.messages[0].text, /ベンチプレス/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
