import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://zmzm-amber.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(Deno.env.get("CORS_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function createCorsHeaders(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

const governorates = new Set([
  "القاهرة", "الإسكندرية", "بورسعيد", "السويس", "دمياط", "الدقهلية",
  "الشرقية", "القليوبية", "كفر الشيخ", "الغربية", "المنوفية", "البحيرة",
  "الإسماعيلية", "الجيزة", "بني سويف", "الفيوم", "المنيا", "أسيوط",
  "سوهاج", "قنا", "الأقصر", "أسوان", "البحر الأحمر", "الوادي الجديد",
  "مطروح", "شمال سيناء", "جنوب سيناء",
]);

const trimmed = (value: unknown) => typeof value === "string" ? value.trim() : "";

function validLength(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max;
}

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
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(ip));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: createCorsHeaders(origin),
  });
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { headers: createCorsHeaders(origin) });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_000) return respond({ error: "بيانات الطلب كبيرة جداً." }, 413);

  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 16_000) return respond({ error: "بيانات الطلب كبيرة جداً." }, 413);
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid body");
  } catch {
    return respond({ error: "بيانات الطلب غير صالحة." }, 400);
  }

  // A populated hidden field is treated as a bot and silently ignored.
  if (trimmed(payload.website)) {
    return respond({ ignored: true, order: { items: [], subtotal: 0, shipping: 0, total: 0 } });
  }

  const firstName = trimmed(payload.first_name);
  const lastName = trimmed(payload.last_name);
  const phone = trimmed(payload.phone);
  const governorate = trimmed(payload.governorate);
  const city = trimmed(payload.city);
  const address = trimmed(payload.address);
  const building = trimmed(payload.building);
  const floor = trimmed(payload.floor);
  const apartment = trimmed(payload.apartment);
  const notes = trimmed(payload.notes);
  const idempotencyKey = trimmed(payload.idempotency_key);
  const items = payload.items;

  if (
    !validLength(firstName, 1, 80) ||
    !validLength(lastName, 1, 80) ||
    !/^01[0125][0-9]{8}$/.test(phone) ||
    !governorates.has(governorate) ||
    !validLength(city, 1, 100) ||
    !validLength(address, 1, 250) ||
    !validLength(building, 1, 50) ||
    !validLength(floor, 1, 30) ||
    !validLength(apartment, 1, 30) ||
    notes.length > 500 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey) ||
    !Array.isArray(items) || items.length < 1 || items.length > 20
  ) {
    return respond({ error: "تحقق من بيانات الطلب ثم حاول مرة أخرى." }, 400);
  }

  const productIds = new Set<number>();
  for (const item of items) {
    if (
      !item || typeof item !== "object" ||
      !Number.isSafeInteger(item.product_id) || item.product_id < 1 ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
      productIds.has(item.product_id)
    ) {
      return respond({ error: "قائمة المنتجات غير صالحة." }, 400);
    }
    productIds.add(item.product_id);
  }

  // Supabase Cloud supplies this header at its edge. Do not use a client-supplied
  // X-Forwarded-For value as the rate-limit identity.
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  const projectUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = getSupabaseSecretKey();
  if (!clientIp || !projectUrl || !serviceRoleKey) {
    console.error("create-order is missing trusted platform configuration");
    return respond({ error: "خدمة الطلبات غير جاهزة حالياً." }, 503);
  }

  try {
    const ipHash = await hashClientIp(clientIp, serviceRoleKey);
    const supabaseAdmin = createClient(projectUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: result, error } = await supabaseAdmin.rpc("create_order_secure", {
        p_ip_hash: ipHash,
        p_idempotency_key: idempotencyKey,
        p_first_name: firstName,
        p_last_name: lastName,
        p_phone: phone,
        p_governorate: governorate,
        p_city: city,
        p_address: address,
        p_building: building,
        p_floor: floor,
        p_apartment: apartment,
        p_notes: notes,
        p_items: items,
    });

    if (error) {
      const message = error.message || "";
      if (message.includes("ORDER_RATE_LIMITED")) {
        return respond({ error: "تم إرسال طلبات كثيرة من هذا الاتصال. انتظر قليلاً ثم حاول مرة أخرى." }, 429);
      }
      if (message.includes("ORDER_INVALID")) {
        return respond({ error: "تحقق من بيانات الطلب ثم حاول مرة أخرى." }, 400);
      }
      if (message.includes("INVENTORY_INSUFFICIENT_AVAILABLE")) {
        return respond({ error: "الكمية المطلوبة تتجاوز المتاح حالياً." }, 409);
      }
      if (message.includes("INVENTORY_OPENING_REQUIRED")) {
        return respond({ error: "لم يتم تسجيل مخزون هذا المنتج بعد." }, 409);
      }
      console.error("create-order database request failed", error.code || "unknown");
      return respond({ error: "تعذر حفظ الطلب حالياً. حاول مرة أخرى بعد قليل." }, 500);
    }

    return respond({ order: result });
  } catch (error) {
    console.error("create-order request failed", error instanceof Error ? error.name : "unknown");
    return respond({ error: "تعذر حفظ الطلب حالياً. حاول مرة أخرى بعد قليل." }, 500);
  }
});
