// LINEで受け取ったテキストに対する返信を作る。LINEの通信部分は index.js 側。
import parser from '../../parser.js';

const { parseWorkout, epley1RM } = parser;

export const HELP = [
  '💪 筋トレ記録Bot',
  '',
  '【記録】そのまま送るだけ',
  '・ベンチ60kg×8回',
  '・スクワット 80 5 3セット',
  '・懸垂 10回 3セット',
  '（改行で複数まとめて記録できます）',
  '',
  '【確認】',
  '・今日 … 今日の記録',
  '・履歴 … 最近の記録',
  '・ベスト … 種目ごとの自己ベスト',
  '・取り消し … 直前の記録を削除',
].join('\n');

const COMMANDS = [
  [/^(ヘルプ|help|使い方|\?)$/, 'help'],
  [/^(今日|きょう|today)$/, 'today'],
  [/^(履歴|りれき|history)$/, 'history'],
  [/^(ベスト|自己ベスト|pb|best)$/, 'best'],
  [/^(取り消し|取消|とりけし|削除|undo)$/, 'undo'],
];

export const QUICK_REPLIES = ['今日', '履歴', 'ベスト', '取り消し', 'ヘルプ'];

const fmtKg = (n) => String(Math.round(n * 10) / 10);
const describe = (e) =>
  (e.weight > 0 ? fmtKg(e.weight) + 'kg' : '自重') + '×' + e.reps + '回×' + e.sets + 'セット';

// 日本時間の YYYY-MM-DD
export function jstDate(now) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function fmtDay(date) {
  const d = new Date(date + 'T00:00:00Z');
  const w = '日月火水木金土'[d.getUTCDay()];
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)) + '(' + w + ')';
}

// 入力テキスト → 返信テキスト
export async function handleText(db, userId, text, now = new Date()) {
  const trimmed = String(text || '').normalize('NFKC').trim();
  const cmd = COMMANDS.find(([re]) => re.test(trimmed.toLowerCase()));
  if (cmd) {
    switch (cmd[1]) {
      case 'help': return HELP;
      case 'today': return today(db, userId, now);
      case 'history': return history(db, userId);
      case 'best': return best(db, userId);
      case 'undo': return undo(db, userId);
    }
  }
  return record(db, userId, String(text || ''), now);
}

async function record(db, userId, text, now) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) return HELP;

  const parsed = lines.map((line) => ({ line, r: parseWorkout(line) }));
  const okCount = parsed.filter((p) => p.r.ok).length;
  if (!okCount) {
    const err = parsed[0].r.error;
    return '⚠️ ' + err + '\n\n例: ベンチ60kg×8回\n「ヘルプ」で使い方を表示';
  }

  const date = jstDate(now);
  const out = [];
  for (const [i, { line, r }] of parsed.entries()) {
    if (!r.ok) {
      out.push('⚠️ 「' + line.slice(0, 30) + '」→ ' + r.error);
      continue;
    }
    const e = r.entry;
    const rm = epley1RM(e.weight, e.reps);
    const { results: prev } = await db.prepare(
      'SELECT weight, reps FROM entries WHERE user_id = ? AND exercise = ? AND weight > 0'
    ).bind(userId, e.exercise).all();
    const prevMax = prev.reduce((m, p) => Math.max(m, p.weight), 0);
    const prevRm = prev.reduce((m, p) => Math.max(m, epley1RM(p.weight, p.reps)), 0);

    // 同じメッセージ内の複数行も順番が付くよう1msずつずらす
    const createdAt = new Date(now.getTime() + i).toISOString();
    await db.prepare(
      'INSERT INTO entries (id, user_id, date, created_at, raw, exercise, weight, reps, sets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, date, createdAt, line.slice(0, 200),
      e.exercise, e.weight, e.reps, e.sets).run();

    let msg = '✅ ' + e.exercise + ' ' + describe(e);
    if (rm) msg += '\n　推定1RM ' + fmtKg(rm) + 'kg';
    if (prev.length && e.weight > 0) {
      if (e.weight > prevMax) msg += '\n　🎉 最大重量を更新！（これまで ' + fmtKg(prevMax) + 'kg）';
      else if (rm > prevRm) msg += '\n　🎉 推定1RMを更新！（これまで ' + fmtKg(prevRm) + 'kg）';
    }
    out.push(msg);
  }
  return out.join('\n');
}

async function today(db, userId, now) {
  const date = jstDate(now);
  const { results } = await db.prepare(
    'SELECT * FROM entries WHERE user_id = ? AND date = ? ORDER BY created_at'
  ).bind(userId, date).all();
  if (!results.length) return '今日の記録はまだありません。\n例: ベンチ60kg×8回';
  const volume = results.reduce((s, e) => s + e.weight * e.reps * e.sets, 0);
  const lines = results.map((e) => '・' + e.exercise + ' ' + describe(e));
  return '📅 今日 ' + fmtDay(date) + '\n' + lines.join('\n') +
    (volume ? '\n\n総挙上量 ' + Math.round(volume).toLocaleString('ja-JP') + 'kg' : '');
}

async function history(db, userId) {
  const { results } = await db.prepare(
    'SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 15'
  ).bind(userId).all();
  if (!results.length) return 'まだ記録がありません。\n例: ベンチ60kg×8回';
  const out = ['🗒 最近の記録'];
  let day = null;
  for (const e of results) {
    if (e.date !== day) {
      day = e.date;
      out.push('', fmtDay(day));
    }
    out.push('・' + e.exercise + ' ' + describe(e));
  }
  return out.join('\n');
}

async function best(db, userId) {
  const { results } = await db.prepare(
    'SELECT exercise, weight, reps, date FROM entries WHERE user_id = ?'
  ).bind(userId).all();
  if (!results.length) return 'まだ記録がありません。\n例: ベンチ60kg×8回';
  const map = new Map();
  for (const e of results) {
    const b = map.get(e.exercise) || { max: 0, rm: 0, reps: 0 };
    b.max = Math.max(b.max, e.weight);
    b.rm = Math.max(b.rm, epley1RM(e.weight, e.reps));
    if (e.weight === 0) b.reps = Math.max(b.reps, e.reps);
    map.set(e.exercise, b);
  }
  const out = ['🏆 自己ベスト'];
  for (const [name, b] of [...map].sort((a, b) => b[1].rm - a[1].rm)) {
    out.push(b.max > 0
      ? '・' + name + ' ' + fmtKg(b.max) + 'kg（推定1RM ' + fmtKg(b.rm) + 'kg）'
      : '・' + name + ' 自重 ' + b.reps + '回');
  }
  return out.join('\n');
}

async function undo(db, userId) {
  const last = await db.prepare(
    'SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId).first();
  if (!last) return '取り消す記録がありません。';
  await db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(last.id, userId).run();
  return '🗑 取り消しました: ' + last.exercise + ' ' + describe(last);
}
