-- TroShare database (Cloudflare D1). Apply with:
--   npx wrangler d1 execute troshare-db --remote --file schema.sql
-- Safe to run again: it only creates what's missing.

-- One row per student who has signed in with a verified @usc.edu Google account.
CREATE TABLE IF NOT EXISTS users (
  sub        TEXT PRIMARY KEY,          -- Google account ID
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  given      TEXT NOT NULL DEFAULT '',
  family     TEXT NOT NULL DEFAULT '',
  picture    TEXT NOT NULL DEFAULT '',
  year       TEXT NOT NULL DEFAULT '',  -- class year, e.g. 'Junior'
  hall       TEXT NOT NULL DEFAULT '',  -- residence hall id, e.g. 'webb'
  since      INTEGER,                   -- year they joined TroShare
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- Items students list for rent. A listing's hall is its owner's current hall.
CREATE TABLE IF NOT EXISTS listings (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL REFERENCES users(sub),
  type         TEXT NOT NULL,           -- item type id from data.js (bean, lamp, …)
  title        TEXT NOT NULL,
  condition    TEXT NOT NULL,
  sem          INTEGER NOT NULL,        -- $ per semester
  year1        INTEGER NOT NULL,        -- $ for a full year
  handoff      TEXT NOT NULL,           -- 'both' | 'drop' | 'pickup'
  open_to_sell INTEGER NOT NULL DEFAULT 0,
  photos       TEXT NOT NULL DEFAULT '[]', -- JSON array of photo keys in the PHOTOS KV namespace
  -- Real-world size from the listing photo, once an AR model has been built.
  -- Existing databases get this column from the Worker the first time someone builds a model.
  model_json   TEXT, -- {"width_m","height_m","depth_m","size"}
  status       TEXT NOT NULL DEFAULT 'available', -- 'available' | 'paused'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, created_at);
CREATE INDEX IF NOT EXISTS listings_owner ON listings(owner);

-- Saved listings. listing_id may also be a built-in sample listing (l1, l2, …).
CREATE TABLE IF NOT EXISTS favorites (
  sub        TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sub, listing_id)
);

-- Real chats between two students about one listing (one conversation per listing and buyer).
-- The listing's title, type, first photo and price are copied in so the chat still makes sense
-- after the listing is edited or deleted.
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL,
  buyer         TEXT NOT NULL REFERENCES users(sub),
  seller        TEXT NOT NULL REFERENCES users(sub),
  listing_title TEXT NOT NULL,
  listing_type  TEXT NOT NULL,
  listing_photo TEXT NOT NULL DEFAULT '',  -- photo key in PHOTOS, or '' for the stock picture
  listing_sem   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_at       INTEGER NOT NULL,
  buyer_read    INTEGER NOT NULL DEFAULT 0, -- id of the last message the buyer has seen
  seller_read   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (listing_id, buyer)
);
CREATE INDEX IF NOT EXISTS conversations_buyer ON conversations(buyer, last_at);
CREATE INDEX IF NOT EXISTS conversations_seller ON conversations(seller, last_at);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id    TEXT NOT NULL,
  sender     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'text', -- 'text', or 'sys' for events like a rental request
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, id);
