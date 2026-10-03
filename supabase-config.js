import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let supabaseClient = null;
let supabaseConfigurationError = "";

if (!supabaseUrl || !supabaseAnonKey) {
  supabaseConfigurationError = "أضف VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY إلى إعدادات البيئة.";
} else {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    console.error("Supabase configuration is invalid.", error);
    supabaseConfigurationError = "إعدادات Supabase غير صالحة. تحقق من رابط المشروع والمفتاح العام.";
  }
}

export { supabaseClient, supabaseConfigurationError };
