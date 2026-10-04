import { supabaseClient, supabaseConfigurationError } from "../../supabase-config.js";
import { escapeHtml, normalizeDigits, safeImageUrl } from "./safe-dom.js";
import { DELIVERY_TIME_NOTE, getShippingFee } from "./shipping.js";

const CART_STORAGE_KEY = "zmzm-cart";
const CART_ITEM_LIMIT = 99;
const WHATSAPP_NUMBER = "201024311053";
const PRODUCT_FIELDS = "id,name,category,price,image,type";
let cart = [];
let productsReady = false;
let previousOrderFingerprint = "";
let previousOrderIdempotencyKey = "";

const money = (value) => `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;

function readStoredCart() {
  try {
    const value = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item) =>
      Number.isFinite(Number(item?.product?.id)) &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      item.quantity <= CART_ITEM_LIMIT
    );
  } catch (error) {
    console.error("تعذرت قراءة السلة.", error);
    return [];
  }
}

function getTotals(items, governorate = "") {
  const subtotal = items.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shipping = getShippingFee(subtotal, governorate);
  return { subtotal, shipping, total: shipping === null ? null : subtotal + shipping };
}

function setCheckoutTotalText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderSummary(message = "") {
  const container = document.getElementById("checkoutItems");
  const submitButton = document.querySelector("#checkoutForm button[type='submit']");
  if (submitButton) submitButton.disabled = !productsReady || cart.length === 0;

  if (message) {
    container.innerHTML = `<div class="empty-cart" role="alert">${escapeHtml(message)}</div>`;
    return;
  }

  if (!cart.length) {
    container.innerHTML = '<div class="empty-cart">السلة فارغة حالياً. عد إلى المتجر لإضافة منتجات.</div>';
    for (const id of ["checkoutSubtotal", "mobileCheckoutSubtotal", "checkoutTotal", "mobileCheckoutTotal"]) {
      setCheckoutTotalText(id, "٠ ج.م");
    }
    for (const id of ["checkoutShipping", "mobileCheckoutShipping"]) {
      setCheckoutTotalText(id, "—");
    }
    for (const id of ["checkoutDeliveryNote", "mobileCheckoutDeliveryNote"]) {
      setCheckoutTotalText(id, DELIVERY_TIME_NOTE);
    }
    return;
  }

  const governorate = document.querySelector('#checkoutForm [name="governorate"]')?.value || "";
  const { subtotal, shipping, total } = getTotals(cart, governorate);
  container.innerHTML = cart.map(({ product, quantity }) => {
    const image = safeImageUrl(product.image);
    const thumb = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" decoding="async" />`
      : product.type === "box"
        ? `<img src="${import.meta.env.BASE_URL}assets/cake-box-white-v2.webp" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />`
        : "S";

    return `
      <div class="checkout-item">
        <div class="checkout-thumb ${image || product.type === "box" ? "has-image" : ""}">${thumb}</div>
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <span class="qty">الكمية: ${quantity}</span>
        </div>
        <strong>${money(product.price * quantity)}</strong>
      </div>
    `;
  }).join("");

  const shippingText = shipping === null
    ? "اختر المحافظة لحساب الشحن"
    : shipping
      ? money(shipping)
      : "مجاني";
  const totalText = total === null
    ? "اختر المحافظة"
    : money(total);
  for (const id of ["checkoutSubtotal", "mobileCheckoutSubtotal"]) {
    setCheckoutTotalText(id, money(subtotal));
  }
  for (const id of ["checkoutShipping", "mobileCheckoutShipping"]) {
    setCheckoutTotalText(id, shippingText);
  }
  for (const id of ["checkoutTotal", "mobileCheckoutTotal"]) {
    setCheckoutTotalText(id, totalText);
  }
  for (const id of ["checkoutDeliveryNote", "mobileCheckoutDeliveryNote"]) {
    setCheckoutTotalText(id, DELIVERY_TIME_NOTE);
  }
}

async function loadCurrentProducts() {
  const storedCart = readStoredCart();
  if (!storedCart.length) {
    cart = [];
    productsReady = true;
    renderSummary();
    return;
  }

  if (!supabaseClient) {
    productsReady = false;
    renderSummary(supabaseConfigurationError);
    return;
  }

  try {
    const productIds = [...new Set(storedCart.map((item) => Number(item.product.id)))];
    const { data, error } = await supabaseClient
      .from("products")
      .select(PRODUCT_FIELDS)
      .in("id", productIds);
    if (error) throw error;

    const products = new Map((data || []).map((product) => [
      Number(product.id),
      {
        id: Number(product.id),
        name: String(product.name || ""),
        price: Number(product.price),
        image: String(product.image || ""),
        type: String(product.type || ""),
      },
    ]));

    cart = storedCart.flatMap(({ product, quantity }) => {
      const currentProduct = products.get(Number(product.id));
      return currentProduct && Number.isFinite(currentProduct.price) && currentProduct.price >= 0
        ? [{ product: currentProduct, quantity }]
        : [];
    });

    if (cart.length !== storedCart.length) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }

    productsReady = true;
    renderSummary();
  } catch (error) {
    console.error("تعذر تحميل المنتجات الحالية لإتمام الطلب.", error);
    productsReady = false;
    renderSummary("تعذر التحقق من الأسعار حالياً. تحقق من الاتصال ثم أعد تحميل الصفحة.");
  }
}

function normalizePhoneNumber(value) {
  return normalizeDigits(value).replace(/\D/g, "");
}

function getOrderIdempotencyKey(orderPayload) {
  const fingerprint = JSON.stringify(orderPayload);
  if (fingerprint === previousOrderFingerprint && previousOrderIdempotencyKey) {
    return previousOrderIdempotencyKey;
  }

  previousOrderFingerprint = fingerprint;
  previousOrderIdempotencyKey = crypto.randomUUID();
  return previousOrderIdempotencyKey;
}

function initCheckout() {
  const form = document.getElementById("checkoutForm");
  const phoneInput = form.querySelector('input[name="phone"]');
  form.querySelector('[name="governorate"]').addEventListener("change", () => renderSummary());
  renderSummary("جارٍ التحقق من المنتجات والأسعار...");
  phoneInput.addEventListener("input", () => {
    phoneInput.value = normalizePhoneNumber(phoneInput.value).slice(0, 11);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!productsReady || !cart.length) {
      renderSummary(!productsReady
        ? "تعذر التحقق من المنتجات والأسعار. حاول مرة أخرى لاحقاً."
        : "السلة فارغة، الرجاء إضافة منتجات أولاً.");
      return;
    }

    const formData = Object.fromEntries(new FormData(form).entries());
    formData.firstName = String(formData.firstName || "").trim();
    formData.lastName = String(formData.lastName || "").trim();
    formData.phone = normalizePhoneNumber(formData.phone);

    if (!formData.firstName || !formData.lastName) {
      alert("يرجى إدخال الاسم الأول واسم العائلة.");
      return;
    }

    if (!/^01[0125][0-9]{8}$/.test(formData.phone)) {
      alert("رقم الهاتف يجب أن يكون رقم هاتف مصري صحيحًا مكونًا من 11 رقمًا ويبدأ بـ 01.");
      phoneInput.focus();
      return;
    }

    const { shipping } = getTotals(cart, formData.governorate);
    if (shipping === null) {
      alert("يرجى اختيار المحافظة لحساب تكلفة الشحن.");
      form.querySelector('[name="governorate"]').focus();
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    const orderPayload = {
      first_name: formData.firstName,
      last_name: formData.lastName,
      phone: formData.phone,
      governorate: formData.governorate,
      city: String(formData.city || "").trim(),
      address: String(formData.address || "").trim(),
      building: String(formData.building || "").trim(),
      floor: String(formData.floor || "").trim(),
      apartment: String(formData.apartment || "").trim(),
      notes: String(formData.notes || "").trim(),
      items: cart.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
      website: String(formData.website || ""),
    };
    const idempotencyKey = getOrderIdempotencyKey(orderPayload);
    const whatsappWindow = window.open("about:blank", "_blank");
    submitButton.disabled = true;
    let savedOrder;
    try {
      const { data, error } = await supabaseClient.functions.invoke("create-order", {
        body: { ...orderPayload, idempotency_key: idempotencyKey },
      });
      if (error) throw error;
      if (data?.ignored) throw new Error("تعذر إرسال الطلب.");
      savedOrder = data?.order;
      if (!savedOrder || !Array.isArray(savedOrder.items) || !savedOrder.items.length) {
        throw new Error("لم تصل تفاصيل الطلب المحفوظ.");
      }
    } catch (error) {
      console.error("تعذر حفظ الطلب.", error);
      if (whatsappWindow) whatsappWindow.close();
      const status = error?.context?.status || error?.status;
      alert(status === 429
        ? "تم إرسال طلبات كثيرة من هذا الاتصال. انتظر قليلاً ثم حاول مرة أخرى."
        : "تعذر حفظ الطلب حالياً. لم يتم مسح السلة؛ حاول مرة أخرى بعد قليل.");
      submitButton.disabled = false;
      return;
    }

    localStorage.removeItem(CART_STORAGE_KEY);
    const messageLines = [
      "طلب جديد من موقع زمزم",
      "",
      `رقم الطلب: ${savedOrder.order_id}`,
      `الاسم: ${formData.firstName} ${formData.lastName}`,
      `الهاتف: ${formData.phone}`,
      `المحافظة: ${formData.governorate}`,
      `المدينة: ${orderPayload.city}`,
      `العنوان: ${orderPayload.address}`,
      `المبنى: ${orderPayload.building || "-"}`,
      `الطابق: ${orderPayload.floor || "-"}`,
      `الشقة: ${orderPayload.apartment || "-"}`,
      `ملاحظات: ${orderPayload.notes || "-"}`,
      "",
      "المنتجات:",
      ...savedOrder.items.map((item) =>
        `- ${item.name} × ${item.quantity} — ${money(Number(item.unit_price) * Number(item.quantity))}`
      ),
      "",
      `المجموع الفرعي: ${money(savedOrder.subtotal)}`,
      `التوصيل: ${Number(savedOrder.shipping) ? money(savedOrder.shipping) : "مجاني"}`,
      `الإجمالي: ${money(savedOrder.total)}`,
      DELIVERY_TIME_NOTE,
    ];
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(messageLines.join("\n"))}`;
    if (whatsappWindow) {
      whatsappWindow.location.replace(whatsappUrl);
      whatsappWindow.opener = null;
      alert("تم حفظ الطلب، جاري فتح واتساب لإرسال بياناته.");
      window.location.href = "index.html";
      return;
    }

    alert("تم حفظ الطلب. تعذر فتح نافذة جديدة، سيتم فتح واتساب في الصفحة الحالية.");
    window.location.href = whatsappUrl;
  });

  loadCurrentProducts();
}

initCheckout();
