# TroShare server

TroShare's back end is a single Cloudflare Worker ([worker.js](worker.js)). It does three jobs:

1. **USC sign-in.** It accepts only verified `@usc.edu` Google accounts and then issues a TroShare session token.
2. **Student data.** It stores profiles, listings and favorites, so each student's account works on any device.
3. **AI.** It calls Claude with TroShare's Anthropic API key for room recommendations, and to measure a listing photo before building its AR model. Visitors never need a key, and the key never reaches the browser or this repository.

- **Live URL:** `https://troshare-room-proxy.thomas-haihang-du.workers.dev`
- **Allowed sites:** the Worker only accepts requests from `https://duhaihang233.github.io`, plus localhost addresses for testing (`localhost:8000`, `127.0.0.1:8000`, `127.0.0.1:8765`). To add more, edit `ALLOWED_ORIGINS` in [worker.js](worker.js). Every endpoint except `/auth/google`, `/photos/…`, and `/listing-models/…` requires a session.
- **Storage:**

  | What | Where |
  |---|---|
  | Students, listings, favorites | D1 database `troshare-db` (tables in [schema.sql](schema.sql)) |
  | Listing photos (JPEG) and generated AR models | KV namespace `PHOTOS` |
  | Profiles from before the database existed | KV namespace `PROFILES`, copied into D1 the first time each student shows up |

- **Limits per student:** 20 listings with up to 4 photos each (about 1 MB per photo); 5 new listings, 5 room analyses, and 5 photo models per minute.
- **AI:** the Worker builds both Claude requests itself (model `claude-opus-5-5`, a fixed prompt, a JSON schema), so the key can't be pointed at an arbitrary question. A listing model measures one photo (capped at 45 seconds) and stores a floor-standing GLB and USDZ textured with that photo. Room analysis costs about $0.04.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /auth/google` | Exchanges a Google ID token for a TroShare session (USC accounts only) |
| `GET /me` | Your account, profile and favorites |
| `PUT /me/profile` | Saves your class year and hall |
| `GET /listings` | Everyone's available listings, plus all of yours |
| `POST /listings` | Publishes a listing (photos sent as base64 JPEG) |
| `PATCH /listings/:id` | Edits your listing, or hides/shows it (`status: "paused"` / `"available"`) |
| `DELETE /listings/:id` | Deletes your listing, its photos, and its AR model |
| `POST /listings/:id/model` | Measures your listing's first photo and stores an AR model. The listing is already published. |
| `PUT` / `DELETE /favorites/:id` | Saves or unsaves a listing |
| `GET /photos/:key` | Listing photo (public, cached for a year) |
| `GET /listing-models/:id.glb` and `.usdz` | Generated AR model (public, so the phone's AR viewer can download it) |
| `POST /analyze-room` | AI room recommendations |

## Common tasks

Run these in this folder:

```bash
npx wrangler deploy                                              # publish changes to worker.js
npx wrangler d1 execute troshare-db --remote --file schema.sql   # create tables (safe to re-run)
npx wrangler d1 execute troshare-db --remote --command "SELECT email, year, hall FROM users"   # look at the data
npx wrangler secret put ANTHROPIC_API_KEY                        # replace the API key (paste it when asked)
npx wrangler tail                                                # watch live requests and errors

# Local testing, with a local database (create its tables first with --local instead of --remote):
npx wrangler dev --port 8799 --var SESSION_SECRET:local-test-secret --var ANTHROPIC_API_KEY:sk-ant-...
```
