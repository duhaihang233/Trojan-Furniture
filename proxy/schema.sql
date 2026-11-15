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
  buy_price    INTEGER,                 -- $ to buy it outright ("Buy now"), set when open_to_sell is 1.
                                        -- Added later; on an older database: ALTER TABLE listings ADD COLUMN buy_price INTEGER;
  photos       TEXT NOT NULL DEFAULT '[]', -- JSON array of photo keys in the PHOTOS KV namespace
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

-- AI-generated AR models (proxy/ar.js). One row per listing that asked for one.
CREATE TABLE IF NOT EXISTS ar_models (
  listing_id  TEXT PRIMARY KEY,
  status      TEXT NOT NULL,             -- 'in_progress' | 'success' | 'failed'
  error       TEXT NOT NULL DEFAULT '',
  spec        TEXT,                      -- JSON shape description when status is 'success'
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);

-- Roommates. A student invites another by @usc.edu email; pending until that student accepts.
CREATE TABLE IF NOT EXISTS roommates (
  id          TEXT PRIMARY KEY,
  inviter     TEXT NOT NULL REFERENCES users(sub),
  email       TEXT NOT NULL,              -- the invited student's email, lowercase
  invitee     TEXT REFERENCES users(sub), -- set when they accept
  status      TEXT NOT NULL,              -- 'pending' | 'accepted'
  created_at  INTEGER NOT NULL,
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS roommates_inviter ON roommates(inviter);
CREATE INDEX IF NOT EXISTS roommates_email ON roommates(email, status);
CREATE INDEX IF NOT EXISTS roommates_invitee ON roommates(invitee);

-- Orders: a student renting or buying another student's listing (status flow in orders.js).
-- Listing details are copied in, so an order still reads right if the listing changes or is deleted.
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL,
  renter        TEXT NOT NULL REFERENCES users(sub),  -- the renter or buyer
  seller        TEXT NOT NULL REFERENCES users(sub),
  kind          TEXT NOT NULL,             -- 'rent' | 'buy'
  plan          TEXT,                      -- 'sem' | 'yr' for rentals
  handoff       TEXT NOT NULL,             -- 'drop' | 'pick'
  price         INTEGER NOT NULL,          -- $ total
  listing_title TEXT NOT NULL,
  listing_type  TEXT NOT NULL,
  listing_photo TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,             -- requested | accepted | declined | canceled | active | return_requested | completed
  split_with    TEXT REFERENCES users(sub), -- roommate asked to pay half
  split_status  TEXT,                      -- pending | accepted | declined
  conv_id       TEXT,                      -- the renter-seller chat
  return_by     TEXT,                      -- YYYY-MM-DD for rentals
  reminded      INTEGER NOT NULL DEFAULT 0, -- 1 after the 7-day reminder, 2 after the due-date one
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS orders_renter ON orders(renter, status);
CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller, status);
CREATE INDEX IF NOT EXISTS orders_split ON orders(split_with);
CREATE INDEX IF NOT EXISTS orders_listing ON orders(listing_id, status);

-- Ratings after a finished order: renter and seller rate each other once.
CREATE TABLE IF NOT EXISTS reviews (
  order_id   TEXT NOT NULL,
  author     TEXT NOT NULL REFERENCES users(sub),
  subject    TEXT NOT NULL REFERENCES users(sub),
  stars      INTEGER NOT NULL,             -- 1 to 5
  text       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (order_id, author)
);
CREATE INDEX IF NOT EXISTS reviews_subject ON reviews(subject, created_at);

-- In-app notifications (the Activity list in Inbox).
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user       TEXT NOT NULL REFERENCES users(sub),
  kind       TEXT NOT NULL,                -- order | split | return | review | roommate
  text       TEXT NOT NULL,
  link       TEXT NOT NULL DEFAULT '',     -- app route, e.g. #/order/o…
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user, id);

-- Web Push subscriptions (one per device that turned notifications on).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user       TEXT NOT NULL REFERENCES users(sub),
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user);
