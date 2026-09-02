const STORAGE_KEY = "zmzm-products";
const defaultProducts = [
  { id: 1, name: "لوح كيك ذهبي دائري 20 سم", category: "boards", price: 45, old: 55, tag: "الأكثر مبيعاً", type: "goldboard", meta: "ذهبي · 20 سم · 3 مم", rating: 4.9 },
  { id: 2, name: "علبة كيك بيضاء 20×20×20", category: "boxes", price: 85, tag: "جديد", type: "box", meta: "كرتون غذائي · 20 سم", rating: 4.8 },
  { id: 3, name: "لوح كيك فضي دائري 25 سم", category: "boards", price: 55, tag: "", type: "silverboard", meta: "فضي · 25 سم · 3 مم", rating: 4.7 },
  { id: 4, name: "علبة كب كيك — 6 قطع", category: "cupcakes", price: 62, old: 75, tag: "عرض", type: "cup", meta: "6 قطع · نافذة شفافة", rating: 4.9 },
  { id: 5, name: "علبة كيك بيضاء 25×25×25", category: "boxes", price: 105, tag: "", type: "box", meta: "كرتون غذائي · 25 سم", rating: 4.8 },
  { id: 6, name: "شريط ساتان أزرق — 10 متر", category: "packaging", price: 38, tag: "جديد", type: "ribbon", meta: "أزرق ملكي · 10 متر", rating: 4.6 },
  { id: 7, name: "علبة كب كيك — 12 قطعة", category: "cupcakes", price: 88, tag: "", type: "cup", meta: "12 قطعة · نافذة شفافة", rating: 4.8 },
  { id: 8, name: "لوح كيك ذهبي دائري 30 سم", category: "boards", price: 75, tag: "", type: "goldboard", meta: "ذهبي · 30 سم · 3 مم", rating: 4.9 },
  { id: 9, name: "علبة كيك طويلة 30 سم", category: "boxes", price: 130, tag: "جديد", type: "box", meta: "طويلة · 30×30×20 سم", rating: 4.7 },
  { id: 10, name: "مجموعة ملصقات سُكّر", category: "packaging", price: 25, tag: "", type: "ribbon", meta: "36 ملصقاً · دائري", rating: 4.6 }
];
const products = (() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (error) {
      console.warn("Failed to parse saved products, falling back to default data.");
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProducts));
  return defaultProducts;
})();

const state = { cart: [], filter: "all", search: "", sort: "popular", visible: 8 };
const $ = (selector) => document.querySelector(selector);
const money = (value) => `${value.toLocaleString("ar-EG")} ج.م`;
const categoryLabel = { boards: "ألواح الكيك", boxes: "علب الكيك", cupcakes: "كب كيك", packaging: "تغليف" };

function productArt(product) {
  if (product.type === "goldboard" || product.type === "silverboard") return `<div class="product-art ${product.type}"></div>`;
  if (product.type === "cup") return `<div class="product-art cup"><i></i><i></i><i></i></div>`;
  return `<div class="product-art ${product.type}"></div>`;
}

function filteredProducts() {
  let result = products.filter((product) => {
    const matchesFilter = state.filter === "all" || product.category === state.filter;
    const query = state.search.toLowerCase();
    return matchesFilter && (!query || `${product.name} ${product.meta} ${product.id}`.toLowerCase().includes(query));
  });
  if (state.sort === "low") result.sort((a, b) => a.price - b.price);
  if (state.sort === "high") result.sort((a, b) => b.price - a.price);
  if (state.sort === "new") result.sort((a, b) => b.id - a.id);
  return result;
}

function renderProducts() {
  const result = filteredProducts();
  const visible = result.slice(0, state.visible);
  $("#resultsCount").textContent = `عرض ${visible.length} من ${result.length} منتجات`;
  $("#productGrid").innerHTML = visible.length ? visible.map((product) => `
    <article class="product-card" data-product-id="${product.id}">
      <div class="product-image ${product.category}">${product.tag ? `<span class="product-badge">${product.tag}</span>` : ""}<button class="wish" aria-label="إضافة إلى المفضلة">♡</button><button class="quick-view" data-id="${product.id}">عرض سريع</button>${productArt(product)}</div>
      <div class="product-info"><h3>${product.name}</h3><div class="product-meta">★ ${product.rating} &nbsp; · &nbsp; ${product.meta}</div><div class="product-row"><span class="price">${money(product.price)} ${product.old ? `<del class="old-price">${money(product.old)}</del>` : ""}</span><button class="add-to-cart" data-id="${product.id}" aria-label="إضافة ${product.name} للسلة">＋</button></div></div>
    </article>`).join("") : `<div class="empty-cart" style="grid-column:1/-1">لم نجد منتجات مطابقة لبحثك. جرّب كلمة أخرى.</div>`;
  $("#loadMore").style.display = state.visible < result.length ? "block" : "none";
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = state.cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shipping = subtotal ? (subtotal >= 500 ? 0 : 35) : 0;
  $("#cartCount").textContent = count;
  $("#drawerCount").textContent = `${count} منتجات`;
  $("#cartItems").innerHTML = state.cart.length ? state.cart.map(({ product, quantity }) => `
    <div class="cart-item"><div class="cart-thumb">${productArt(product)}</div><div><h4>${product.name}</h4><small>${product.meta}</small><div class="cart-controls"><button data-action="decrease" data-id="${product.id}">−</button><span>${quantity}</span><button data-action="increase" data-id="${product.id}">＋</button></div></div><div><strong>${money(product.price * quantity)}</strong><button class="remove-item" data-action="remove" data-id="${product.id}">حذف</button></div></div>`).join("") : `<div class="empty-cart">سلتك فارغة حالياً<br /><small>أضف بعض القطع الجميلة لتبدأ.</small></div>`;
  $("#subtotal").textContent = money(subtotal);
  $("#shipping").textContent = shipping ? money(shipping) : (subtotal ? "مجاني" : "—");
  $("#total").textContent = money(subtotal + shipping);
}

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}
function openCart() { $("#cartDrawer").classList.add("open"); $("#drawerOverlay").classList.add("visible"); }
function closeCart() { $("#cartDrawer").classList.remove("open"); $("#drawerOverlay").classList.remove("visible"); }
function addToCart(id) {
  const product = products.find((item) => item.id === id);
  const existing = state.cart.find((item) => item.product.id === id);
  if (existing) existing.quantity += 1; else state.cart.push({ product, quantity: 1 });
  renderCart(); toast("تمت إضافة المنتج إلى السلة"); openCart();
}

$("#productGrid").addEventListener("click", (event) => {
  const button = event.target.closest(".add-to-cart");
  if (button) addToCart(Number(button.dataset.id));
  if (event.target.closest(".wish")) toast("تمت إضافة المنتج إلى المفضلة");
  const quickView = event.target.closest(".quick-view");
  if (quickView) {
    const product = products.find((item) => item.id === Number(quickView.dataset.id));
    $("#modalContent").innerHTML = `<div class="modal-product"><div class="product-image ${product.category}">${productArt(product)}</div><div><span class="kicker">${categoryLabel[product.category]}</span><h2>${product.name}</h2><div class="product-meta">★ ${product.rating} &nbsp; · &nbsp; ${product.meta}</div><p>حل أنيق وعملي يحافظ على منتجك ويمنحه مظهراً احترافياً من لحظة التسليم وحتى أول قضمة.</p><div class="price">${money(product.price)}</div><button class="btn btn-primary wide modal-add" data-id="${product.id}">أضف للسلة <span>←</span></button></div></div>`;
    $("#quickModal").classList.add("open"); $("#modalBackdrop").classList.add("visible");
  }
});
$("#modalContent").addEventListener("click", (event) => { const button = event.target.closest(".modal-add"); if (button) { addToCart(Number(button.dataset.id)); $("#quickModal").classList.remove("open"); $("#modalBackdrop").classList.remove("visible"); } });
function closeModal() { $("#quickModal").classList.remove("open"); $("#modalBackdrop").classList.remove("visible"); }
$("#modalClose").addEventListener("click", closeModal); $("#modalBackdrop").addEventListener("click", closeModal);
$("#cartItems").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const item = state.cart.find((entry) => entry.product.id === Number(button.dataset.id));
  if (!item) return;
  if (button.dataset.action === "increase") item.quantity += 1;
  if (button.dataset.action === "decrease") item.quantity -= 1;
  if (button.dataset.action === "remove" || item.quantity < 1) state.cart = state.cart.filter((entry) => entry !== item);
  renderCart();
});
$("#filterBar").addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  state.filter = button.dataset.filter; state.visible = 8;
  document.querySelectorAll("#filterBar button").forEach((item) => item.classList.toggle("active", item === button)); renderProducts();
});
document.querySelectorAll("[data-filter-link]").forEach((link) => link.addEventListener("click", () => {
  state.filter = link.dataset.filterLink; document.querySelector(`#filterBar button[data-filter="${state.filter}"]`)?.click();
}));
$("#sortSelect").addEventListener("change", (event) => { state.sort = event.target.value; renderProducts(); });
$("#loadMore").addEventListener("click", () => { state.visible += 4; renderProducts(); });
$("#cartToggle").addEventListener("click", openCart); $("#closeCart").addEventListener("click", closeCart); $("#drawerOverlay").addEventListener("click", closeCart);
$("#checkoutBtn").addEventListener("click", () => state.cart.length ? toast("سيتم فتح صفحة الدفع قريباً — شكراً لثقتك!") : toast("أضف منتجاً إلى السلة أولاً"));
$("#couponBtn").addEventListener("click", () => $("#couponInput").value.trim() ? toast("تم تطبيق كود الخصم بنجاح") : toast("اكتب كود الخصم أولاً"));
$("#searchToggle").addEventListener("click", () => { $("#searchPanel").classList.toggle("open"); $("#searchInput").focus(); });
$("#closeSearch").addEventListener("click", () => $("#searchPanel").classList.remove("open"));
$("#searchInput").addEventListener("input", (event) => { state.search = event.target.value; state.visible = 8; renderProducts(); });
$("#menuToggle").addEventListener("click", () => $("#mainNav").classList.toggle("open"));
const navLinks = document.querySelectorAll(".main-nav a");
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) => item.classList.toggle("active", item === link));
  });
});
const newsletterForm = $("#newsletterForm"); if (newsletterForm) newsletterForm.addEventListener("submit", (event) => { event.preventDefault(); event.target.reset(); toast("تم اشتراكك! تحقق من بريدك للعروض القادمة."); });
const langToggle = $("#langToggle"); if (langToggle) langToggle.addEventListener("click", () => toast("النسخة الإنجليزية قيد الإعداد"));
document.querySelectorAll("[data-scroll]").forEach((button) => button.addEventListener("click", () => document.querySelector(button.dataset.scroll)?.scrollIntoView()));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCart(); });
renderProducts(); renderCart();
