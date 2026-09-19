// The whole database, as one idempotent script (CREATE … IF NOT EXISTS). SQLite dialect: runs unchanged on node:sqlite
// (local), libSQL / Turso (Vercel) and Cloudflare D1. New tables only ever get appended, so existing databases upgrade by
// running it again. xp_ledger is the source of truth; players.xp is a cache written in the same batch.
export const SCHEMA = `-- Mission X — M1 schema. SQLite dialect: runs unchanged on node:sqlite (local) and Cloudflare D1 (production).
-- xp_ledger is the source of truth; players.xp is a cache written in the same batch.

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  callsign    TEXT NOT NULL UNIQUE,
  cls         TEXT,
  xp          INTEGER NOT NULL DEFAULT 0,
  docked_at   INTEGER,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passports (
  player_id          TEXT PRIMARY KEY REFERENCES players(id),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  company            TEXT NOT NULL,
  role               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  email              TEXT NOT NULL,
  show_contact       INTEGER NOT NULL DEFAULT 0,
  consent_notice     INTEGER NOT NULL,
  consent_marketing  INTEGER NOT NULL DEFAULT 0,
  consent_at         INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS xp_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL REFERENCES players(id),
  action      TEXT NOT NULL,
  target      TEXT,
  xp          INTEGER NOT NULL,
  detail      TEXT,
  voided      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS xp_ledger_player ON xp_ledger(player_id, created_at);

CREATE TABLE IF NOT EXISTS stamps (
  player_id   TEXT NOT NULL REFERENCES players(id),
  station_id  TEXT NOT NULL,
  hall        INTEGER NOT NULL,
  proof       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, station_id)
);
CREATE INDEX IF NOT EXISTS stamps_recent ON stamps(created_at);

CREATE TABLE IF NOT EXISTS halls_seen (
  player_id   TEXT NOT NULL REFERENCES players(id),
  hall        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, hall)
);

CREATE TABLE IF NOT EXISTS landmarks_seen (
  player_id   TEXT NOT NULL REFERENCES players(id),
  area_id     TEXT NOT NULL,
  day         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, area_id, day)
);

CREATE TABLE IF NOT EXISTS tickets (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL UNIQUE REFERENCES players(id),
  code         TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  redeemed_at  INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT,
  name        TEXT NOT NULL,
  props       TEXT,
  created_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------- M2
-- New per-player data lives in its own tables so existing databases upgrade with CREATE IF NOT EXISTS alone.

CREATE TABLE IF NOT EXISTS avatars (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  spec        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_prefs (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  fields      TEXT NOT NULL
);

-- A claimed booth. status: pending (live, awaiting crew review) | approved | revoked (dark again, owner cannot re-claim).
CREATE TABLE IF NOT EXISTS stations (
  station_id    TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES players(id),
  company       TEXT NOT NULL,
  offer         TEXT NOT NULL DEFAULT '',
  link          TEXT NOT NULL DEFAULT '',
  color         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  claimed_at    INTEGER NOT NULL,
  host_seen_at  INTEGER,
  host_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stations_owner ON stations(owner_id);

-- The consent record: who shared which fields with whom, when, and whether they took it back.
CREATE TABLE IF NOT EXISTS card_shares (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_player  TEXT NOT NULL REFERENCES players(id),
  to_station   TEXT,
  to_player    TEXT REFERENCES players(id),
  fields       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS card_shares_station ON card_shares(from_player, to_station) WHERE to_station IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS card_shares_player ON card_shares(from_player, to_player) WHERE to_player IS NOT NULL;
CREATE INDEX IF NOT EXISTS card_shares_to_station ON card_shares(to_station);
CREATE INDEX IF NOT EXISTS card_shares_to_player ON card_shares(to_player);

CREATE TABLE IF NOT EXISTS verified_contacts (
  player_id   TEXT NOT NULL REFERENCES players(id),
  station_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, station_id)
);

-- One row per pair, a_id < b_id.
CREATE TABLE IF NOT EXISTS links (
  a_id        TEXT NOT NULL REFERENCES players(id),
  b_id        TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE INDEX IF NOT EXISTS links_b ON links(b_id);

CREATE TABLE IF NOT EXISTS link_codes (
  code        TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_notes (
  owner_id     TEXT NOT NULL REFERENCES players(id),
  contact_key  TEXT NOT NULL,
  note         TEXT NOT NULL,
  PRIMARY KEY (owner_id, contact_key)
);

-- hall 0 = not tied to a sector (links); sector ticks ignore it.
CREATE TABLE IF NOT EXISTS influence_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  crew        TEXT NOT NULL,
  hall        INTEGER NOT NULL,
  weight      REAL NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS influence_recent ON influence_events(hall, created_at);

CREATE TABLE IF NOT EXISTS sector_ticks (
  tick        INTEGER NOT NULL,
  hall        INTEGER NOT NULL,
  holder      TEXT,
  scores      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tick, hall)
);

-- ---------------------------------------------------------------- M3
-- Venue checks keep the verdict only. Raw coordinates are never stored.
CREATE TABLE IF NOT EXISTS venue_checks (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  ok          INTEGER NOT NULL,
  dist_m      INTEGER NOT NULL,
  acc_m       INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_flags (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  hidden      INTEGER NOT NULL DEFAULT 0
);

-- Last on-site proof (beacon with a good venue check, or a host code): where and when the person really was.
CREATE TABLE IF NOT EXISTS anchors (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  station_id  TEXT NOT NULL,
  anchored_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS walks (
  player_id   TEXT NOT NULL REFERENCES players(id),
  day         INTEGER NOT NULL,
  metres      REAL NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);

-- state: offered | active | done | expired | abandoned
CREATE TABLE IF NOT EXISTS missions (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  template    TEXT NOT NULL,
  params      TEXT NOT NULL,
  progress    TEXT NOT NULL,
  state       TEXT NOT NULL,
  xp          INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  done_at     INTEGER
);
CREATE INDEX IF NOT EXISTS missions_player ON missions(player_id, state);

-- How many explorers came looking for an unclaimed booth — shown to the exhibitor when they bring it online.
CREATE TABLE IF NOT EXISTS dark_visits (
  station_id  TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (station_id, player_id)
);

CREATE TABLE IF NOT EXISTS storms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zone        TEXT NOT NULL,
  x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL
);

-- Ground Control co-op. state: active | done | expired
CREATE TABLE IF NOT EXISTS gc_queue (
  player_id   TEXT PRIMARY KEY REFERENCES players(id),
  role        TEXT NOT NULL,
  queued_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gc_sessions (
  id          TEXT PRIMARY KEY,
  ground_id   TEXT NOT NULL REFERENCES players(id),
  astro_id    TEXT NOT NULL REFERENCES players(id),
  station_id  TEXT NOT NULL,
  state       TEXT NOT NULL,
  waypoints   TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  done_at     INTEGER
);
CREATE INDEX IF NOT EXISTS gc_ground ON gc_sessions(ground_id, state);
CREATE INDEX IF NOT EXISTS gc_astro ON gc_sessions(astro_id, state);

-- ---------------------------------------------------------------- M4
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL REFERENCES players(id), kind TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flags_player ON flags(player_id, created_at);
CREATE TABLE IF NOT EXISTS bans (player_id TEXT PRIMARY KEY REFERENCES players(id), reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS step_stats (player_id TEXT NOT NULL REFERENCES players(id), day INTEGER NOT NULL, steps INTEGER NOT NULL DEFAULT 0, metres REAL NOT NULL DEFAULT 0, PRIMARY KEY (player_id, day));
CREATE TABLE IF NOT EXISTS teams (owner_id TEXT PRIMARY KEY REFERENCES players(id), name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS team_members (player_id TEXT PRIMARY KEY REFERENCES players(id), owner_id TEXT NOT NULL REFERENCES teams(owner_id), joined_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS team_members_owner ON team_members(owner_id);

-- ---------------------------------------------------------------- serverless
-- Who is where, right now. On a single Node process this lives in memory (PresenceStore); on Vercel every request may
-- land on a different instance, so it lives here. Rows are overwritten every ping and go stale after 15 s.
CREATE TABLE IF NOT EXISTS presence (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  callsign TEXT NOT NULL, cls TEXT, pose TEXT NOT NULL DEFAULT '', av TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, h REAL NOT NULL, deck INTEGER NOT NULL DEFAULT 0, sigma REAL NOT NULL DEFAULT 0,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS presence_fresh ON presence(t);
`;
