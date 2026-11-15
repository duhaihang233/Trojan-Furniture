# TroShare server

TroShare's back end is a single Cloudflare Worker ([worker.js](worker.js)). It does three jobs:

1. **USC sign-in.** It accepts only verified `@usc.edu` Google accounts and then issues a TroShare session token.
2. **Student data.** It stores profiles, listings, favorites and chats, so each student's account works on any device.
3. **AI room planner.** It calls Claude with TroShare's Anthropic API key. Visitors never need a key, and the key never reaches the browser or this repository.
4. **AI AR models.** When a seller turns on **AI Generate AR model**, Claude describes the item in their photos as simple 3D shapes at real size ([ar.js](ar.js) has the prompt and output schema). The browser builds the model from that description with [armodel.js](../armodel.js), which uses the same shapes and textures as the built-in models. Generation takes about 10 seconds and runs after the listing is published (`ctx.waitUntil`), so the seller never waits. Its status is `in_progress`, `success` or `failed`.

- **Live URL:** `https://troshare-room-proxy.thomas-haihang-du.workers.dev`
- **Allowed sites:** the Worker only accepts requests from `https://duhaihang233.github.io`, plus two localhost addresses for testing. To add more, edit `ALLOWED_ORIGINS` in [worker.js](worker.js). Every endpoint except `/auth/google` and `/photos/…` requires a session.
- **Storage:**

  | What | Where |
  |---|---|
  | Students, listings, favorites, chats | D1 database `troshare-db` (tables in [schema.sql](schema.sql)) |
  | Listing photos (JPEG) | KV namespace `PHOTOS` |
  | Profiles from before the database existed | KV namespace `PROFILES`, copied into D1 the first time each student shows up |

- **Limits per student:** 20 listings with up to 4 photos each (about 1 MB per photo); 5 new listings, 30 chat messages and 5 room analyses per minute.
- **AI room planner:** the Worker builds the whole Claude request itself (model `claude-opus-5-5`, prompt, JSON schema), so the key can't be used for anything else. It costs about $0.04 per analysis.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /auth/google` | Exchanges a Google ID token for a TroShare session (USC accounts only) |
| `GET /me` | Your account, profile and favorites |
| `PUT /me/profile` | Saves your class year and hall |
| `GET /listings` | Everyone's available listings, plus all of yours |
| `POST /listings` | Publishes a listing (photos sent as base64 JPEG) |
| `PATCH /listings/:id` | Edits your listing, or hides/shows it (`status: "paused"` / `"available"`) |
| `DELETE /listings/:id` | Deletes your listing and its photos |
| `PUT` / `DELETE /favorites/:id` | Saves or unsaves a listing |
| `GET /conversations` | Your chats, with the latest message and unread count |
| `POST /conversations` | Opens (or reopens) the chat with a listing's owner |
| `GET /conversations/:id/messages?after=N` | Messages newer than `N` (the app polls every 4 s); marks them read |
| `POST /conversations/:id/messages` | Sends a message, or a renter event (`rent`, `confirm`) the server words itself |
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
npx wrangler tail                                                # watch live requests and errors

# Local testing, with a local database (create its tables first with --local instead of --remote):
npx wrangler dev --port 8799 --var SESSION_SECRET:local-test-secret --var ANTHROPIC_API_KEY:sk-ant-...
```
