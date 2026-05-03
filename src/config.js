// ─────────────────────────────────────────────
//  CONFIGURATION
//  No secrets here — all keys are server-side.
// ─────────────────────────────────────────────

export const CONFIG = {
  SHEET_NAME: import.meta.env.VITE_SHEET_NAME || 'Recipes',
  API_BASE:   '/api',
};