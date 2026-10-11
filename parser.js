// 筋トレ記録の自由入力パーサー。
// Node (require) とブラウザ (<script>) の両方から使える。
(function (root) {
  'use strict';

  const ALIASES = {
    'ベンチ': 'ベンチプレス',
    'bp': 'ベンチプレス',
    'デッド': 'デッドリフト',
    'dl': 'デッドリフト',
    'sq': 'スクワット',
    'ohp': 'オーバーヘッドプレス',
    'チンニング': '懸垂',
  };

  const UNIT_KIND = [
    [/^(kg|kgs|キロ|キログラム)$/, 'kg'],
    [/^(lb|lbs|ポンド)$/, 'lb'],
    [/^(回|rep|reps|レップ)$/, 'reps'],
    [/^(セット|set|sets)$/, 'sets'],
  ];

  const NUMBER_RE =
    /(\d+(?:\.\d+)?)\s*(キログラム|キロ|ポンド|レップ|セット|回|(?:kgs?|lbs?|reps?|sets?)(?![a-z]))?/g;
  const SEP = '[\\s,、。・:：@/*x×✕]*';

  function unitKind(unit) {
    if (!unit) return null;
    for (const [re, kind] of UNIT_KIND) if (re.test(unit)) return kind;
    return null;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // 推定1RM (Epley)。1回はそのままの重量。
  function epley1RM(weight, reps) {
    if (!(weight > 0) || !(reps > 0)) return 0;
    if (reps === 1) return weight;
    return round1(weight * (1 + reps / 30));
  }

  // "ベンチ60kg×8回" → { ok: true, entry: { exercise, weight, reps, sets } }
  // 失敗時は { ok: false, error }
  function parseWorkout(input) {
    if (typeof input !== 'string') return { ok: false, error: '入力が空です' };
    const text = input.normalize('NFKC').toLowerCase().trim();
    if (!text) return { ok: false, error: '入力が空です' };

    let weight = null;
    let reps = null;
    let sets = null;
    const bare = [];
    const bodyweight = /自重|bw\b/.test(text);

    const marked = text.replace(/自重|bw\b/g, ' ').replace(NUMBER_RE, (_, num, unit) => {
      const n = Number(num);
      const kind = unitKind(unit);
      if (kind === 'kg' && weight === null) weight = n;
      else if (kind === 'lb' && weight === null) weight = round1(n * 0.45359237);
      else if (kind === 'reps' && reps === null) reps = n;
      else if (kind === 'sets' && sets === null) sets = n;
      else bare.push(n);
      return '\u0000';
    });

    if (bodyweight && weight === null) weight = 0;

    // 単位なしの数値は 重量 → 回数 → セット数 の順に空いている所へ
    for (const n of bare) {
      if (weight === null) weight = n;
      else if (reps === null) reps = n;
      else if (sets === null) sets = n;
      else return { ok: false, error: '数値が多すぎます' };
    }

    // 「懸垂 10回」のように回数だけ明示された場合は自重扱い
    if (weight !== null && reps === null && bare.length === 1 && !bodyweight && sets !== null) {
      // 例: "腕立て 20 3セット" → 20回×3セット (自重)
      reps = weight;
      weight = 0;
    }
    if (weight === null && reps !== null) weight = 0;
    if (sets === null) sets = 1;

    let exercise = marked
      .replace(new RegExp(SEP + '\u0000' + SEP, 'g'), ' ')
      .replace(/^[\s,、。・:：@/]+|[\s,、。・:：@/]+$/g, '')
      .replace(/\s+/g, ' ');
    exercise = ALIASES[exercise] || exercise;

    if (!exercise) return { ok: false, error: '種目名が見つかりません' };
    if (exercise.length > 40) return { ok: false, error: '種目名が長すぎます' };
    if (reps === null) return { ok: false, error: '回数が見つかりません（例: ベンチ60kg×8回）' };
    if (!Number.isInteger(reps) || reps < 1 || reps > 1000) {
      return { ok: false, error: '回数は1以上の整数で入力してください' };
    }
    if (!Number.isInteger(sets) || sets < 1 || sets > 100) {
      return { ok: false, error: 'セット数は1以上の整数で入力してください' };
    }
    if (weight < 0 || weight > 1000) return { ok: false, error: '重量が範囲外です' };

    return { ok: true, entry: { exercise, weight, reps, sets } };
  }

  const api = { parseWorkout, epley1RM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintoreParser = api;
})(typeof self !== 'undefined' ? self : this);
