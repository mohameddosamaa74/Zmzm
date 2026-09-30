// IMPORTANT: do not commit your real Supabase URL/key to GitHub.
// Fill these values locally only, or set them in the browser before loading admin.js.
// Example:
// window.ZMZAM_SUPABASE = { url: "https://abcd1234.supabase.co", anonKey: "eyJ...", enabled: true };
if (!window.ZMZAM_SUPABASE) {
  window.ZMZAM_SUPABASE = {
    url: "",
    anonKey: "",
    enabled: false
  };
}

if (
  !window.ZMZAM_SUPABASE.url ||
  !window.ZMZAM_SUPABASE.anonKey ||
  window.ZMZAM_SUPABASE.url.includes("YOUR_") ||
  window.ZMZAM_SUPABASE.anonKey.includes("YOUR_")
) {
  window.ZMZAM_SUPABASE.enabled = false;
}
