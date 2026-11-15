# TroShare server

TroShare's back end is a single Cloudflare Worker ([worker.js](worker.js)). It does these jobs:

1. **USC sign-in.** It accepts only verified `@usc.edu` Google accounts and then issues a TroShare session token.
2. **Student data.** It stores profiles, listings, favorites and chats, so each student's account works on any device.
3. **AI room planner.** It calls Claude with TroShare's Anthropic API key. Visitors never need a key, and the key never reaches the browser or this repository.
4. **AI AR models.** When a seller turns on **AI Generate AR model**, Claude describes the item in their photos as simple 3D shapes at real size ([ar.js](ar.js) has the prompt and output schema). The browser builds the model from that description with [armodel.js](../armodel.js), which uses the same shapes and textures as the built-in models. Generation takes 30–60 seconds (Claude with adaptive thinking at high effort) and runs in a Durable Object (`ArJobs` in worker.js, one per listing) from an alarm, so it keeps going after the seller's request returns and the seller never waits. After 5 minutes a stuck job shows as failed. Its status is `in_progress`, `success` or `failed`.

5. **Orders, ratings and notifications** ([orders.js](orders.js)). Requests, accept/decline, handoff, returns, roommate splits and ratings, each with a chat line and a notification. A daily cron (`[triggers]` in wrangler.toml, 17:00 UTC) sends return reminders 7 days before and on the due date.
6. **Push notifications** ([push.js](push.js)). Web Push with VAPID and aes128gcm encryption, written with WebCrypto (no dependencies). Each notification and each new chat message is pushed to the student's devices that turned notifications on.

- **Live URL:** `https://troshare-room-proxy.thomas-haihang-du.workers.dev`
- **Allowed sites:** the Worker only accepts requests from `https://duhaihang233.github.io`, plus two localhost addresses for testing. To add more, edit `ALLOWED_ORIGINS` in [worker.js](worker.js). Every endpoint except `/auth/google` and `/photos/…` requires a session.
- **Storage:**

  | What | Where |
  |---|---|
  | Students, listings, favorites, chats, roommates, orders, ratings, notifications, push subscriptions | D1 database `troshare-db` (tables in [schema.sql](schema.sql)) |
  | Listing photos (JPEG) | KV namespace `PHOTOS` |
  | Profiles from before the database existed | KV namespace `PROFILES`, copied into D1 the first time each student shows up |

- **Limits per student:** 100 listings with up to 4 photos each (about 1 MB per photo); 5 new listings, 30 chat messages and 5 room analyses per minute.
- **Easy list:** Claude (`claude-opus-5-5`, low effort, JSON schema) fills in a listing from its photos, using the room planner's key. 5 per minute per student. Roughly 1–3 cents each; the response includes token `usage` to check.
- **USC Housing rules check:** [housing.js](housing.js) holds USC Housing's prohibited possessions (2026-27 Living Agreement, section O, and the Fall 2026 Arriving Guide) as rules. Claude (`claude-opus-5-5`, medium effort, JSON schema) only says which rules the item might fall under and how sure it is; the code decides. Publishing (`POST /listings`) and edits that change the photos or title are always checked on the server: blocked items get a 422, unsure ones need `housingConfirmed`, restricted ones are stored in `listings.housing` and shown to renters. A check the seller ran from the form comes with a signed token (tied to the student and the exact photos and title, 30 minutes), so publishing doesn't pay for it twice. If the check can't run, publishing waits (503) rather than skipping it. Listings published before the check existed are audited by the daily cron, 5 at a time (`housing_checked`): ones USC Housing prohibits are hidden and the owner is told why (they can edit or delete them); unsure ones stay up and the owner is asked to confirm; restricted ones get the renter note. Update `RULES` when USC Housing publishes a new Living Agreement.
- **AI room planner:** the Worker builds the whole Claude request itself (model `claude-opus-5-5`, prompt, JSON schema), so the key can't be used for anything else. It costs about $0.04 per analysis.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /auth/google` | Exchanges a Google ID token for a TroShare session (USC accounts only) |
| `POST /auth/guest` | Guest demo account (only while `GUEST_DEMO` is `"on"`): browse, Easy list and the housing check only; everything else is 403. Lasts a day; removed by the cron after two |
| `GET /me` | Your account, profile, favorites and rating |
| `PUT /me/profile` | Saves your class year and hall |
| `GET /listings` | Everyone's available listings, plus all of yours |
| `POST /listings` | Publishes a listing (photos sent as base64 JPEG) |
| `POST /listings/draft` | Easy list: 1–4 photos (base64 JPEG) in; a suggested `title`, `category`, `condition` and `conditionNote` out ([easy.js](easy.js)) |
| `POST /listings/check` | USC Housing rules check for photos + title: `verdict` (`ok`, `restricted`, `confirm`, `blocked`), the findings, and a token to publish with ([housing.js](housing.js)) |
| `PATCH /listings/:id` | Edits your listing: any field, or `photos` as the new list in order (`{ key }` keeps a photo, `{ data }` adds a base64 JPEG). Changing photos rebuilds an AI AR model. Also hides/shows it (`status: "paused"` / `"available"`). `openToSell: true` needs a `buyPrice` (the Buy now price) |
| `DELETE /listings/:id` | Deletes your listing and its photos |
| `PUT` / `DELETE /favorites/:id` | Saves or unsaves a listing |
| `GET /roommates` | Your roommates and invites (sent and received, `pending` or `accepted`) |
| `POST /roommates` | Invites a roommate by `email` (@usc.edu only) |
| `POST /roommates/:id/accept` | Accepts an invite sent to your email |
| `DELETE /roommates/:id` | Cancels, declines or removes a roommate |
| `GET /orders` | Your orders as renter, seller or roommate asked to split |
| `POST /orders` | Requests to rent (`kind: "rent"`, `plan`) or buy (`kind: "buy"`) a listing, with `handoff`, an optional `note`, and `splitWith` (a roommate id) |
| `POST /orders/:id/:action` | `accept`, `decline` (seller); `cancel`, `handoff`, `return` (renter); `returned` (seller); `split-accept`, `split-decline` (roommate) |
| `POST /orders/:id/review` | Rates the other student once the order is finished (`stars` 1–5, optional `text`) |
| `GET /notifications` | Your latest 50 notifications and the unread count (also sends any due return reminders) |
| `POST /notifications/read` | Marks them all read |
| `POST` / `DELETE /push/subscribe` | Saves or removes this device's push subscription |
| `POST /push/test` | Sends a test notification to your devices |
| `GET /conversations` | Your chats, with the latest message and unread count |
| `POST /conversations` | Opens (or reopens) the chat with a listing's owner |
| `GET /conversations/:id/messages?after=N` | Messages newer than `N` (the app polls every 4 s); marks them read |
| `POST /conversations/:id/messages` | Sends a message, or a renter event (`rent`, `buy`, `confirm`) the server words itself |
| `GET /listings/:id/ar-model` | AR model status and shape description |
| `POST /listings/:id/ar-model` | Generates (or regenerates) the AR model for your listing |
| `GET /photos/:key` | Listing photo (public, cached for a year) |
| `POST /analyze-room` | AI room recommendations |

## Common tasks

Run these in this folder:

```bash
npx wrangler deploy                                              # publish changes to worker.js
npx wrangler d1 execute troshare-db --remote --file schema.sql   # create tables (safe to re-run)
npx wrangler d1 execute troshare-db --remote --command "SELECT email, year, hall FROM users"   # look at the data
npx wrangler secret put ANTHROPIC_API_KEY                        # replace the room planner's API key (paste it when asked)
npx wrangler secret put ANTHROPIC_AR_KEY                         # replace the AR model generator's API key
npx wrangler secret put VAPID_PRIVATE_JWK                        # push key (private JWK); its public half is VAPID_PUBLIC_KEY in wrangler.toml and config.js
npx wrangler tail                                                # watch live requests and errors

# Local testing, with a local database (create its tables first with --local instead of --remote):
npx wrangler dev --port 8799 --var SESSION_SECRET:local-test-secret --var ANTHROPIC_API_KEY:sk-ant-...
```
