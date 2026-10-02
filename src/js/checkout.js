const CART_STORAGE_KEY = "zmzm-cart";
const WHATSAPP_NUMBER = "201024311053";
const money = (value) => `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;

function getCart() {
  const saved = localStorage.getItem(CART_STORAGE_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function getTotals(items) {
  const subtotal = items.reduce((sum, entry) => sum + Number(entry.product.price) * Number(entry.quantity), 0);
  const shipping = subtotal ? (subtotal >= 500 ? 0 : 35) : 0;
  const total = subtotal + shipping;
  return { subtotal, shipping, total };
}

function renderSummary() {
  const items = getCart();
  const container = document.getElementById("checkoutItems");

  if (!items.length) {
    container.innerHTML = '<div class="empty-cart">السلة فارغة حالياً. عد إلى المتجر لإضافة منتجات.</div>';
    document.getElementById("checkoutSubtotal").textContent = "٠ ج.م";
    document.getElementById("checkoutShipping").textContent = "—";
    document.getElementById("checkoutTotal").textContent = "٠ ج.م";
    return;
  }

  const { subtotal, shipping, total } = getTotals(items);

  container.innerHTML = items.map(({ product, quantity }) => `
    <div class="checkout-item">
      <div class="checkout-thumb ${product.image || (product.type === "box" ? "has-image" : "")}">
        ${product.image
          ? `<img src="${product.image}" alt="${product.name}" />`
          : (product.type === "box"
              ? `<img src="${product.name.toLowerCase().includes("beige") ? "/assets/cake-box-beige.png" : "/assets/cake-box-white.png"}" alt="${product.name}" />`
              : "S")}
        </div>
      <div>
        <h3>${product.name}</h3>
        <span class="qty">الكمية: ${quantity}</span>
      </div>
      <strong>${money(product.price * quantity)}</strong>
    </div>
  `).join("");

  document.getElementById("checkoutSubtotal").textContent = money(subtotal);
  document.getElementById("checkoutShipping").textContent = shipping ? money(shipping) : "مجاني";
  document.getElementById("checkoutTotal").textContent = money(total);
}

function buildWhatsAppMessage(formData) {
  const items = getCart();
  const { subtotal, shipping, total } = getTotals(items);
  const messageLines = [
    "طلب جديد من موقع زمزم",
    "",
    `الاسم: ${formData.firstName} ${formData.lastName}`,
    `الهاتف: ${formData.phone}`,
    `البريد الإلكتروني: ${formData.email || "-"}`,
    `المحافظة: ${formData.governorate}`,
    `المدينة: ${formData.city}`,
    `العنوان: ${formData.address}`,
    `المبنى: ${formData.building || "-"}`,
    `الطابق: ${formData.floor || "-"}`,
    `الشقة: ${formData.apartment || "-"}`,
    `ملاحظات: ${formData.notes || "-"}`,
    "",
    "المنتجات:",
    ...items.map(({ product, quantity }) => `- ${product.name} × ${quantity} — ${money(product.price * quantity)}`),
    "",
    `المجموع الفرعي: ${money(subtotal)}`,
    `التوصيل: ${shipping ? money(shipping) : "مجاني"}`,
    `الإجمالي: ${money(total)}`
  ];

  return messageLines.join("\n");
}

function initCheckout() {
  renderSummary();

  const form = document.getElementById("checkoutForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const items = getCart();
    if (!items.length) {
      alert("السلة فارغة، الرجاء إضافة منتجات أولاً.");
      window.location.href = "index.html";
      return;
    }

    const formData = Object.fromEntries(new FormData(form).entries());
    const message = buildWhatsAppMessage(formData);
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodedMessage}`;

    window.open(whatsappUrl, "_blank");
    localStorage.removeItem(CART_STORAGE_KEY);
    alert("تم تجهيز الطلب بنجاح، جاري فتح واتساب لإرسال بيانات الطلب.");
    window.location.href = "index.html";
  });
}

initCheckout();
