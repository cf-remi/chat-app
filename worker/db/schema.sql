CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username   TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  pw_hash    TEXT NOT NULL,
  pw_salt    TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT UNIQUE DEFAULT (substr(lower(hex(randomblob(4))),1,8)),
  is_public   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('text', 'voice')),
  meeting_id  TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (server_id, user_id)
);
