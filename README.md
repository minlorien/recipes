# Recipes — Setup Guide

## What you need before starting
- GitHub account (new one you just created)
- Cloudflare account (you already have one — same login as your domain)
- Google account with Sheets access (you have this)
- Anthropic API key (you have this)

---

## Step 1: Fill in your config

Open `src/config.js` and fill in:

```js
APP_PASSWORD: 'choose-a-family-password',   // e.g. 'Minlorien2024'
ANTHROPIC_API_KEY: 'sk-ant-...',            // your key from console.anthropic.com
SHEETS_ID: '',                               // fill in after Step 3
SHEETS_API_KEY: '',                          // fill in after Step 3
```

---

## Step 2: Push to GitHub

On your computer, open Terminal (Mac) or Command Prompt (Windows) and run:

```bash
cd path/to/recipes-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/recipes.git
git push -u origin main
```

Replace YOUR-USERNAME with your new GitHub username.

---

## Step 3: Google Sheets setup (≈10 minutes)

### 3a. Create the spreadsheet
1. Go to sheets.google.com → create a new spreadsheet
2. Name it "Family Recipes"
3. Copy the ID from the URL:
   `https://docs.google.com/spreadsheets/d/[COPY-THIS-PART]/edit`
4. Paste that ID into `src/config.js` as `SHEETS_ID`

### 3b. Get a Google Sheets API key
1. Go to console.cloud.google.com
2. Create a new project (call it "Rezepte")
3. Go to "APIs & Services" → "Enable APIs"
4. Search for "Google Sheets API" and enable it
5. Go to "APIs & Services" → "Credentials"
6. Click "Create Credentials" → "API Key"
7. Copy the key → paste into `src/config.js` as `SHEETS_API_KEY`
8. Click "Edit API key" → restrict it to "Google Sheets API" only

### 3c. Make the sheet readable by the API
1. In your Google Sheet, click "Share"
2. Change "General access" to "Anyone with the link" → "Viewer"
   (The API key handles write access; this allows reading without auth)

---

## Step 4: Deploy to Cloudflare Pages (≈5 minutes)

1. Log into dash.cloudflare.com
2. Go to "Workers & Pages" → "Create application" → "Pages"
3. Click "Connect to Git" → authorize GitHub → select your `rezepte` repo
4. Build settings:
   - Framework: None
   - Build command: `npm install && npm run build`
   - Build output directory: `dist`
5. Click "Save and Deploy" — first deploy takes ~2 minutes

### 4b. Add your custom subdomain
1. In Cloudflare Pages → your project → "Custom domains"
2. Click "Set up a custom domain"
3. Enter: `recipes.minlorien.net`
4. Cloudflare will automatically create the DNS record (since your domain is already there)
5. Done — it's live at recipes.minlorien.net within minutes

---

## Step 5: First use

1. Visit recipes.minlorien.net
2. Enter your family password
3. Tap "Add" → scan your first recipe photo
4. Review the AI extraction, adjust if needed, and save

To install as an app on iPhone:
- Open recipes.minlorien.net in Safari
- Tap the Share button → "Add to Home Screen"
- It will appear as an icon on the home screen

To install as an app on Android:
- Open in Chrome
- Tap the three-dot menu → "Add to Home Screen"

---

## Updating the app later

Whenever you want to change anything:
1. Edit the files on your computer
2. Run: `git add . && git commit -m "update" && git push`
3. Cloudflare automatically rebuilds and redeploys — takes about 90 seconds

---

## Troubleshooting

**Recipes not loading:** Check that your Google Sheet is shared as "Anyone with link - Viewer" and that the SHEETS_ID and SHEETS_API_KEY are correct in config.js.

**Photo scan not working:** Verify your ANTHROPIC_API_KEY is correct and has credits.

**App won't install on phone:** Must be served over HTTPS — Cloudflare Pages always does this, so it should work automatically.
