# TroShare room-analysis proxy

This is a Cloudflare Worker behind the web app's **AI Room** tab. The site sends room photos here, and the Worker calls Claude with TroShare's Anthropic API key and returns the recommendations. Visitors never need a key, and the key never reaches the browser or this repository.

- **Live URL:** `https://troshare-room-proxy.thomas-haihang-du.workers.dev/analyze-room`
- **Allowed sites:** only requests from `https://duhaihang233.github.io` (plus two localhost addresses for testing) are accepted. Edit `ALLOWED_ORIGINS` in [worker.js](worker.js) to add more.
- **Requests:** the Worker builds the whole Claude request itself (model `claude-opus-5-5`, prompt, JSON schema). The client only sends up to 5 base64 JPEG photos, the hall name, and listing counts and prices. The key can't be used for anything else.
- **Rate limit:** 5 analyses per minute per IP address, set in [wrangler.toml](wrangler.toml).
- **Cost:** about $0.04 per analysis.

## Common tasks

Run these in this folder:

```bash
npx wrangler deploy                          # publish changes to worker.js
npx wrangler secret put ANTHROPIC_API_KEY    # replace the API key (paste it when asked)
npx wrangler tail                            # watch live requests and errors
npx wrangler dev --var ANTHROPIC_API_KEY:sk-ant-...   # run locally on http://127.0.0.1:8787
```
