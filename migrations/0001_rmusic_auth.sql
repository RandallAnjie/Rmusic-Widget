CREATE TABLE IF NOT EXISTS rmusic_users (
  id TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS rmusic_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  aaguid TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_credentials_user_idx ON rmusic_credentials(user_id);

CREATE TABLE IF NOT EXISTS rmusic_auth_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_id TEXT,
  user_handle TEXT,
  display_name TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rmusic_auth_challenges_expiry_idx ON rmusic_auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS rmusic_user_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  user_agent TEXT,
  last_ip_hash TEXT,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_user_sessions_user_idx ON rmusic_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS rmusic_user_sessions_expiry_idx ON rmusic_user_sessions(expires_at);
