-- 項目はWebアプリの書き出しJSONと同じ形 (id, date, createdAt, raw, exercise, weight, reps, sets)
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,      -- YYYY-MM-DD (日本時間)
  created_at TEXT NOT NULL,      -- ISO 8601
  raw        TEXT,
  exercise   TEXT NOT NULL,
  weight     REAL NOT NULL,      -- kg。自重は 0
  reps       INTEGER NOT NULL,
  sets       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries (user_id, created_at);
