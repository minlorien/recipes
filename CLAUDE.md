# Family Recipe App — recipes.minlorien.net

Bilingual (EN/DE) family recipe PWA. The main user is Bert's wife, who is not
technical: every flow must be faster than flipping through the paper recipe book.
Bert (owner) is a former engineering manager, comfortable with code and Linux.

## Stack

- **Frontend:** vanilla JS (no framework) + Vite 5. Entry `index.html` → `src/main.js`.
- **Hosting:** Cloudflare Pages, project `recipes`, custom domain `recipes.minlorien.net`.
  Every push to `main` on `github.com/minlorien/recipes` auto-deploys.
  Build command `npm install && npm run build`, output `dist`.
- **Backend:** Cloudflare Pages Function `functions/api/[[route]].js` (repo root, NOT
  under `src/`). It is the only place secrets live. Routes:
  - `POST /api/login` — checks `APP_PASSWORD`, returns HMAC session token
  - `POST /api/ai` — proxies to Anthropic Messages API
  - `POST /api/sheets/read` | `/write` | `/delete` — Google Sheets
  - All but `/api/login` require header `x-session-token`.
- **Database:** Google Sheet `1LUMfJAGSqmOAyvOSQ4Cr8gXb9Ku2do2Zk1Ngafen-Bk`, tab `Recipes`.
  Row 1 is the header; data starts row 2. Reads use an API key, writes use a service
  account (`recipes-writer@amiable-nova-493223-j2.iam.gserviceaccount.com`, Editor on the sheet).
- **AI:** Claude via the proxy. Used for photo → recipe extraction (both languages at
  scan time), "you might also like", chat assistant, weekly menu, fridge mode.

## Layout

```
functions/api/[[route]].js   server-side proxy, all secrets
public/manifest.json, sw.js  PWA
src/config.js                non-secret config only (SHEET_NAME, API_BASE='/api')
src/main.js                  shell, router, login screen, EN/DE toggle
src/lib/state.js             state, session token, shopping list (localStorage)
src/lib/sheets.js            sheet row <-> recipe mapping, calls /api/sheets/*
src/lib/ai.js                prompts + callClaude() → /api/ai
src/lib/units.js             metric storage, metric + imperial display
src/lib/ui.js                icons, toasts, fileToBase64 (resize 1568px + grayscale)
src/pages/*.js               recipes, detail, scan, shopping, chat
```

## Sheet schema (columns A–R, order matters — see `COLUMNS` in sheets.js)

`id, title, title_de, category, servings, prep_mins, cook_mins, rating, language, tags,
ingredients, steps, notes, image_url, created_at, updated_at, ingredients_de, steps_de`

`ingredients*` / `steps*` are JSON strings. `tags` is comma-separated. Amounts stored metric.

## Cloudflare environment variables (Settings → Variables)

| Name | Where used |
|---|---|
| `ANTHROPIC_API_KEY` | function only |
| `SHEETS_ID` | function only |
| `SESSION_SECRET` | function only — signs login tokens (falls back to a value derived from `APP_PASSWORD` if unset) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | function only (full JSON) |
| `APP_PASSWORD` | function only |
| `AI_MODEL` | function only, optional — overrides `DEFAULT_AI_MODEL` in the proxy |
| `VITE_SHEET_NAME` | browser (`Recipes`, not secret) |

## Hard rules

- **Never put a secret in a `VITE_*` variable or in `src/`.** Vite inlines `VITE_*` into the
  public bundle; this already leaked the Anthropic key and the service-account key once
  (both rotated). After any change touching config, build and grep `dist/` for `sk-ant`,
  `AIza`, `PRIVATE KEY` — must be zero hits.
- Don't commit `.env` or service-account JSON files. GitHub push protection will block it,
  and a blocked commit still sits in local history (needs an orphan-branch rewrite).
- Keep the UI usable by a non-technical person on a phone: big tap targets, no jargon.
- Always show both metric and imperial amounts.
- Bert prefers whole functions/files when shown code, not fragments to splice in.

## Deploy & verify

```bash
npm install && npm run build      # must succeed locally before pushing
git push                          # Cloudflare auto-deploys from main
```
- Cloudflare "Retry deployment" re-runs the *same old commit*; push a new commit instead.
- Builds can take a minute or two to appear — not a failure.
- After deploy, browsers keep old files: test with Ctrl+Shift+R or incognito.
- Verify the function was picked up: build log must NOT say
  "No functions dir at /functions found".

## Current state (Oct 2026)

Done: AI moved to `claude-sonnet-5-5` with the model pinned server-side (effort `low`,
structured outputs via an optional `schema`, `max_tokens` clamped to 8000); service worker
rewritten (network-first pages, cache-first `/assets/*`, never caches HTML as an asset,
`public/404.html` stops Pages answering missing files with index.html); 30-day signed
session tokens in localStorage; edits update the existing row (server finds it by id);
Sheets reads use the service account (`SHEETS_API_KEY` no longer used); icons, cleanup.

Changing the AI model: set `AI_MODEL` in Cloudflare (then push a commit or redeploy so it
takes effect), or change `DEFAULT_AI_MODEL` in `functions/api/[[route]].js`. Always do a
test scan afterwards — newer models can reject request fields (`effort`, `fallbacks`) or
change the response shape. A retired/unknown model makes the proxy return 410 and log
`MODEL UNAVAILABLE`; the app tells the user to ask Bert.

Gotchas learned:
- Cloudflare Pages serves index.html (200) for any missing path unless a top-level
  `404.html` exists. Keep `public/404.html`.
- Sonnet 5.5 responses can start with a `thinking` block: read text blocks by type.
- Upstream 401/403 (bad Anthropic/Google key) are returned as 502 so the app doesn't log
  the user out.

Open:
- Editing English ingredients/steps doesn't update `ingredients_de`/`steps_de`.
- Sheet can now be made private (service account is Editor), then delete `SHEETS_API_KEY`.

## Testing

No test suite. Minimum before pushing: `npm run build` passes; `npx wrangler pages dev dist`
(with a local `.dev.vars` holding the secrets — gitignored; fake values are fine for UI work) to exercise `/api/*`; login,
list, open a recipe, toggle DE/EN, add to shopping list, scan one photo, save, confirm the
row (incl. `ingredients_de`/`steps_de`) lands in the sheet.
