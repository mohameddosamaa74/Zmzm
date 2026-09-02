window.ZMZAM_SUPABASE = {
  url: "https://YOUR_PROJECT_ID.supabase.co",
  anonKey: "YOUR_ANON_KEY",
  enabled: false
};

if (window.ZMZAM_SUPABASE.url.includes("YOUR_PROJECT_ID") || window.ZMZAM_SUPABASE.anonKey.includes("YOUR_ANON_KEY")) {
  window.ZMZAM_SUPABASE.enabled = false;
}
