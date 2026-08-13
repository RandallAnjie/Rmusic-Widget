CREATE TABLE IF NOT EXISTS rmusic_favorites (
  user_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_favorites_order_idx ON rmusic_favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rmusic_recent (
  user_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_recent_order_idx ON rmusic_recent(user_id, played_at DESC);

CREATE TABLE IF NOT EXISTS rmusic_playlists (
  user_id TEXT NOT NULL,
  playlist_key TEXT NOT NULL,
  source TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  cached_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, playlist_key),
  FOREIGN KEY (user_id) REFERENCES rmusic_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rmusic_playlists_order_idx ON rmusic_playlists(user_id, saved_at DESC);
