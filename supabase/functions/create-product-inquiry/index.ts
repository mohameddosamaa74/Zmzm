import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: corsHeaders,
});

const trimmed = (value: unknown) => typeof value === "string" ? value.trim() : "";

function getSupabaseSecretKey() {
  const namedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (namedKeys) {
    try {
      const keys = JSON.parse(namedKeys);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      return "";
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

async function hashClientIp(ip: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(ip));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 5_000) return json({ error: "بيانات الاستفسار كبيرة جداً." }, 413);

  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 5_000) return json({ error: "بيانات الاستفسار كبيرة جداً." }, 413);
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid body");
  } catch {
    return json({ error: "بيانات الاستفسار غير صالحة." }, 400);
  }

  // Ignore automated form fills without revealing that the trap was detected.
  if (trimmed(payload.website)) return json({ received: true }, 202);

  const productName = trimmed(payload.product_name);
  const description = trimmed(payload.description);
  if (productName.length < 1 || productName.length > 160 || description.length > 1200) {
    return json({ error: "تحقق من اسم المنتج والتفاصيل ثم حاول مرة أخرى." }, 400);
  }

  // Trust only the client IP headers set by Supabase's edge, never a browser-supplied forwarding header.
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  const projectUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = getSupabaseSecretKey();
  if (!clientIp || !projectUrl || !serviceRoleKey) {
    console.error("create-product-inquiry is missing trusted platform configuration");
    return json({ error: "خدمة الاستفسارات غير جاهزة حالياً." }, 503);
  }

  try {
    const supabaseAdmin = createClient(projectUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabaseAdmin.rpc("submit_product_inquiry", {
      p_ip_hash: await hashClientIp(clientIp, serviceRoleKey),
      p_product_name: productName,
      p_description: description || null,
    });

    if (error) {
      if (error.message?.includes("INQUIRY_RATE_LIMITED")) {
        return json({ error: "تم إرسال استفسارات كثيرة. انتظر قليلاً ثم حاول مرة أخرى." }, 429);
      }
      if (error.message?.includes("INQUIRY_INVALID")) {
        return json({ error: "تحقق من اسم المنتج والتفاصيل ثم حاول مرة أخرى." }, 400);
      }
      console.error("create-product-inquiry database request failed", error.code || "unknown");
      return json({ error: "تعذر حفظ الاستفسار حالياً. حاول مرة أخرى بعد قليل." }, 500);
    }

    return json({ received: true });
  } catch (error) {
    console.error("create-product-inquiry request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "تعذر حفظ الاستفسار حالياً. حاول مرة أخرى بعد قليل." }, 500);
  }
});
