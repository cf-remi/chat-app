CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username   TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  pw_hash    TEXT NOT NULL DEFAULT '',
  pw_salt    TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- OAuth accounts linked to users (one user can have multiple OAuth providers)
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_user_id TEXT NOT NULL,
  created_at       INTEGER DEFAULT (unixepoch()),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);

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

CREATE INDEX IF NOT EXISTS idx_server_members_user_id ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_servers_public ON servers(is_public) WHERE is_public = 1;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_files_channel_id ON files(channel_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
