export const CONFIG = {
  APP_PASSWORD:                import.meta.env.VITE_APP_PASSWORD                || '',
  ANTHROPIC_API_KEY:           import.meta.env.VITE_ANTHROPIC_API_KEY           || '',
  SHEETS_ID:                   import.meta.env.VITE_SHEETS_ID                   || '',
  SHEETS_API_KEY:              import.meta.env.VITE_SHEETS_API_KEY              || '',
  SHEET_NAME:                  import.meta.env.VITE_SHEET_NAME                  || 'Recipes',
  GOOGLE_SERVICE_ACCOUNT_JSON: import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_JSON || '{}',
};
