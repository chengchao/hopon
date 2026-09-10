CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 60),
  description TEXT NOT NULL CHECK(length(description) <= 180),
  html TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX games_feed ON games(published, id DESC);
CREATE TABLE generation_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
