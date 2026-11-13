// 這裡只有「公開」設定；請絕對不要放 Supabase secret/service_role 金鑰或 Turnstile secret。
window.PHARMACY_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabasePublishableKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
  turnstileSiteKey: 'YOUR_TURNSTILE_SITE_KEY',
  pharmacyName: '維元社區藥局'
};
