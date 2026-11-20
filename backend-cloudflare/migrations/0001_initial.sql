CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  venue TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  deadline TEXT,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  registration_open INTEGER NOT NULL DEFAULT 1 CHECK (registration_open IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  year TEXT NOT NULL,
  department TEXT NOT NULL,
  accommodation TEXT NOT NULL CHECK (accommodation IN ('Day Scholar', 'Hosteler')),
  confirmed_at TEXT NOT NULL,
  UNIQUE (event_id, email),
  FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS registrations_by_event
  ON registrations (event_id);

CREATE TABLE IF NOT EXISTS pending_verifications (
  event_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  year TEXT NOT NULL,
  department TEXT NOT NULL,
  accommodation TEXT NOT NULL CHECK (accommodation IN ('Day Scholar', 'Hosteler')),
  last_sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (event_id, email),
  FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pending_verifications_by_expiry
  ON pending_verifications (expires_at);

CREATE TABLE IF NOT EXISTS request_limits (
  route TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (route, client_hash)
);

