-- Adds the full-length mirror demo listing, owned by the same account as the other demo items
-- (Thomas Du). Deploy the Worker first so the server accepts the 'mirror' type, then run:
--   npx wrangler deploy
--   npx wrangler d1 execute troshare-db --remote --file seed-mirror.sql
-- Safe to run again: it skips the insert if the listing is already there.
INSERT OR IGNORE INTO listings (id, owner, type, title, condition, sem, year1, handoff, open_to_sell, buy_price, photos, housing, housing_checked, status, created_at, updated_at)
SELECT 'demo-mirror-1', sub, 'mirror', 'Black full-length mirror', 'Like new', 7, 12, 'both', 0, NULL, '[]', '', 1, 'available',
       CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER)
FROM users WHERE name = 'Thomas Du' LIMIT 1;
