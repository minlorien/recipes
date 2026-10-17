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
| `SHEETS_API_KEY` | function only |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | function only (full JSON) |
| `APP_PASSWORD` | function only |
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

## Current state (Oct 2026) — work these first

1. **AI is broken: retired model.** `src/lib/ai.js` sends `model: 'claude-sonnet-4-20250514'`,
   retired 2026-06-15. Replacement per Anthropic: `claude-sonnet-5-5`. Better: set the model
   **server-side** in `functions/api/[[route]].js` (ignore whatever the client sends, also
   clamp `max_tokens`), so the proxy can't be used for arbitrary models and future swaps
   are a one-line server change. Recipe extraction needs ~4000 max_tokens (long
   bilingual JSON got truncated at 3000). Check the migration guide for request-shape
   changes (e.g. `temperature`/`top_p` are rejected on newer models — we don't send them).
2. **Stale PWA on phones — root cause found.** `public/sw.js` precaches `/src/...` paths
   that don't exist in the built `dist/`, so `cache.addAll` rejects, the new service worker
   never installs, and the old one keeps serving cache-first forever. Fix: precache only
   real built assets (or nothing), use network-first for HTML/navigation, bump `CACHE`
   name, and never cache `/api/*`. Consider a self-unregistering SW first to free stuck phones.
3. **Login handler not awaited.** `src/main.js` `attempt()` does `if (!login(...))` on a
   Promise, so wrong passwords never show an error. Make it async/await with a
   "Checking…" button state.
4. **Session token expires at midnight UTC.** `verifyToken` comment says it accepts
   yesterday's token, but it only checks today's. Accept both, or use an expiring signed
   token. Also the HMAC secret is derived from `APP_PASSWORD`; prefer a separate
   `SESSION_SECRET` env var.
5. **Clean-up:** delete stray duplicate `src/functions/api/[[route]].js`; fix or delete
   `wrangler.toml` (Pages warns it's invalid — needs `pages_build_output_dir = "dist"` or
   just remove it); add `public/icons/icon-192.png` and `icon-512.png` (manifest references
   them); add `<meta name="mobile-web-app-capable">`; CORS `*` on the proxy is unnecessary
   (same-origin) — remove or restrict.
6. **Possible improvement:** sheet is shared "anyone with link — viewer" only so the
   API-key read works. Reading via the service account instead would let the sheet be
   private; then `SHEETS_API_KEY` can be dropped.
7. **Scanning reliability:** occasional JSON parse errors. Consider structured outputs /
   a JSON-only response format, one automatic retry, and a clear user message.
   Photo guidance for users: portrait mode, page right-side up, phone directly above.

## Testing

No test suite. Minimum before pushing: `npm run build` passes; `npx wrangler pages dev dist`
(with a local `.dev.vars` holding the secrets — gitignored) to exercise `/api/*`; login,
list, open a recipe, toggle DE/EN, add to shopping list, scan one photo, save, confirm the
row (incl. `ingredients_de`/`steps_de`) lands in the sheet.
