const STORAGE_KEY = "zmzm-products";
const CART_STORAGE_KEY = "zmzm-cart";

// Configuration - Prioritize local window object, then environment variables
const supabaseConfig = window.ZMZAM_SUPABASE || { 
  url: import.meta.env?.VITE_SUPABASE_URL || "", 
  anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY || "",
};

const isSupabaseConfigured = supabaseConfig.url && supabaseConfig.anonKey && !supabaseConfig.url.includes("YOUR_");

let supabaseClient = null;
try {
  if (isSupabaseConfigured && window.supabase) {
    supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
  }
} catch (e) {
  console.error("Supabase client initialization failed:", e);
}



function normalizeProduct(row) {
  return {
    id: Number(row.id ?? 0),
    name: row.name || "",
    category: row.category || "boxes",
    price: Number(row.price || 0),
    old: Number(row.old_price || row.old || 0),
    tag: row.tag || "",
    meta: row.meta || "",
    rating: Number(row.rating || 4.8),
    specs: row.specs || {},
    image: row.image || row.image_url || row.photo || "",
    type: row.type || (row.category === "boards" ? "goldboard" : row.category === "cupcakes" ? "cup" : row.category === "packaging" ? "ribbon" : "box")
  };
}

let products = [];

async function loadProductsFromSupabase() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.from("products").select("*").order("id", { ascending: true });
    if (error) {
      console.warn("Supabase load failed:", error.message);
      return null;
    }
    return data.map(normalizeProduct);
  } catch (e) {
    console.error("Supabase critical error:", e);
    return null;
  }
}

async function syncProductsWithSupabase() {
  if (supabaseClient) {
    // If Supabase is active, we EXCLUSIVELY use Supabase.
    // We clear any existing product list first to avoid merging.
    products = []; 
    const remoteProducts = await loadProductsFromSupabase();
    
    if (remoteProducts) {
      products = remoteProducts;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    } else {
      // Supabase is configured but returned no data or error.
      // We keep products as [] to ensure defaults are NOT shown.
      console.warn("Supabase active but no items found. Hiding defaults.");
    }
  } else {
    // ONLY use defaults if Supabase is completely absent (e.g. local dev)
    console.warn("Supabase not configured. Using defaults.");
    products = defaultProducts;
  }
  renderProducts();
  renderCart();
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const incomingProducts = JSON.parse(event.newValue);
    if (Array.isArray(incomingProducts)) {
      products = incomingProducts;
      renderProducts();
      renderCart();
    }
  } catch (error) {
    console.warn("Storage sync error.");
  }
});

const getStoredCart = () => {
  const saved = localStorage.getItem(CART_STORAGE_KEY);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};
const state = { cart: [], filter: "all", search: "", sort: "popular", visible: 8 };
const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;
const categoryLabel = { boards: "ألواح الكيك", boxes: "علب الكيك", cupcakes: "كب كيك", packaging: "تغليف" };
const persistCart = () => localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));

function productArt(product) {
  if (product.image) {
    return `<img src="${product.image}" alt="${product.name}" style="width:100%;height:100%;object-fit:contain;padding:10px;border-radius:18px;display:block;background:#fff;" />`;
  }
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
  if (state.sort === "new") result.sort((a, b) => a.id - b.id);
  return result;
}

function renderProducts() {
  const grid = $("#productGrid");
  if (!grid) return;
  
  const result = filteredProducts();
  const visible = result.slice(0, state.visible);
  const itemLabel = result.length === 1 ? "منتج" : "منتجات";
  
  const countEl = $("#resultsCount");
  if (countEl) countEl.textContent = `عرض ${visible.length} من ${result.length} ${itemLabel}`;
  
  grid.innerHTML = visible.length ? visible.map((product) => `
    <article class="product-card" data-product-id="${product.id}">
      <div class="product-image ${product.category}">${product.tag ? `<span class="product-badge">${product.tag}</span>` : ""}<button class="wish" aria-label="إضافة إلى المفضلة">♡</button><button class="quick-view" data-id="${product.id}">عرض سريع</button>${productArt(product)}</div>
      <div class="product-info"><h3>${product.name}</h3><div class="product-meta">★ ${product.rating} &nbsp; · &nbsp; ${product.meta}</div><div class="product-row"><span class="price">${money(product.price)} ${product.old ? `<del class="old-price">${money(product.old)}</del>` : ""}</span><button class="add-to-cart" data-id="${product.id}" aria-label="إضافة ${product.name} للسلة">＋</button></div></div>
    </article>`).join("") : `<div class="empty-cart" style="grid-column:1/-1">لم نجد منتجات مطابقة لبحثك. جرّب كلمة أخرى.</div>`;
  
  const loadMore = $("#loadMore");
  if (loadMore) {
    loadMore.style.display = state.visible < result.length ? "block" : "none";
    loadMore.textContent = state.visible < result.length ? "عرض المزيد" : "لا توجد منتجات إضافية";
  }
}

function renderCart() {
  persistCart();
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = state.cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shipping = subtotal ? (subtotal >= 500 ? 0 : 35) : 0;
  
  const cartCount = $("#cartCount"); if (cartCount) cartCount.textContent = count;
  const drawerCount = $("#drawerCount"); if (drawerCount) drawerCount.textContent = `${count} منتجات`;
  
  const cartItems = $("#cartItems");
  if (cartItems) {
    cartItems.innerHTML = state.cart.length ? state.cart.map(({ product, quantity }) => `
    <div class="cart-item"><div class="cart-thumb ${product.image ? "has-image" : ""}">${productArt(product)}</div><div><h4>${product.name}</h4><small>${product.meta}</small><div class="cart-controls"><button data-action="decrease" data-id="${product.id}">−</button><span>${quantity}</span><button data-action="increase" data-id="${product.id}">＋</button></div></div><div><strong>${money(product.price * quantity)}</strong><button class="remove-item" data-action="remove" data-id="${product.id}">حذف</button></div></div>`).join("") : `<div class="empty-cart">سلتك فارغة حالياً<br /><small>أضف بعض القطع الجميلة لتبدأ.</small></div>`;
  }
  
  const subtotalEl = $("#subtotal"); if (subtotalEl) subtotalEl.textContent = money(subtotal);
  const shippingEl = $("#shipping"); if (shippingEl) shippingEl.textContent = shipping ? money(shipping) : (subtotal ? "مجاني" : "—");
  const totalEl = $("#total"); if (totalEl) totalEl.textContent = money(subtotal + shipping);
}

function toast(message) {
  const el = $("#toast"); if (!el) return;
  el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2300);
}
function openCart() { $("#cartDrawer")?.classList.add("open"); $("#drawerOverlay")?.classList.add("visible"); }
function closeCart() { $("#cartDrawer")?.classList.remove("open"); $("#drawerOverlay")?.classList.remove("visible"); }

function addToCart(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const existing = state.cart.find((item) => item.product.id === id);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ product, quantity: 1 });
  }
  persistCart();
  renderCart();
  toast("تمت إضافة المنتج إلى السلة");
  openCart();
}

$("#productGrid")?.addEventListener("click", (event) => {
  const button = event.target.closest(".add-to-cart");
  if (button) {
    const id = Number(button.dataset.id);
    addToCart(id);
  }
  if (event.target.closest(".wish")) toast("تمت إضافة المنتج إلى المفضلة");
  const quickView = event.target.closest(".quick-view");
  if (quickView) {
    const product = products.find((item) => item.id === Number(quickView.dataset.id));
    if (!product) return;
    $("#modalContent").innerHTML = `<div class="modal-product"><div class="product-image ${product.category}">${productArt(product)}</div><div><span class="kicker">${categoryLabel[product.category] || "منتج"}</span><h2>${product.name}</h2><div class="product-meta">★ ${product.rating} &nbsp; · &nbsp; ${product.meta}</div><p>حل أنيق وعملي يحافظ على منتجك ويمنحه مظهراً احترافياً من لحظة التسليم وحتى أول قضمة.</p><div class="price">${money(product.price)}</div><button class="btn btn-primary wide modal-add" data-id="${product.id}">أضف للسلة <span>←</span></button></div></div>`;
    $("#quickModal")?.classList.add("open"); $("#modalBackdrop")?.classList.add("visible");
  }
});

$("#modalContent")?.addEventListener("click", (event) => {
  const button = event.target.closest(".modal-add");
  if (button) {
    addToCart(Number(button.dataset.id));
    $("#quickModal")?.classList.remove("open"); $("#modalBackdrop")?.classList.remove("visible");
  }
});

function closeModal() { $("#quickModal")?.classList.remove("open"); $("#modalBackdrop")?.classList.remove("visible"); }
$("#modalClose")?.addEventListener("click", closeModal);
$("#modalBackdrop")?.addEventListener("click", closeModal);

$("#cartItems")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const id = Number(button.dataset.id);
  const item = state.cart.find((entry) => entry.product.id === id);
  if (!item) return;
  if (button.dataset.action === "increase") {
    item.quantity += 1;
  } else if (button.dataset.action === "decrease") {
    item.quantity -= 1;
  } else if (button.dataset.action === "remove") {
    state.cart = state.cart.filter((entry) => entry.product.id !== id);
  } else {
    return;
  }
  if (item && item.quantity < 1) {
    state.cart = state.cart.filter((entry) => entry.product.id !== id);
  }
  persistCart();
  renderCart();
});

$("#filterBar")?.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  state.filter = button.dataset.filter; state.visible = 8;
  document.querySelectorAll("#filterBar button").forEach((item) => item.classList.toggle("active", item === button)); renderProducts();
});

document.querySelectorAll("[data-filter-link]").forEach((link) => link.addEventListener("click", () => {
  state.filter = link.dataset.filterLink;
  const filterBtn = document.querySelector(`#filterBar button[data-filter="${state.filter}"]`);
  if (filterBtn) filterBtn.click();
}));

$("#sortSelect")?.addEventListener("change", (event) => { state.sort = event.target.value; renderProducts(); });
$("#loadMore")?.addEventListener("click", () => { state.visible += 4; renderProducts(); });
$("#cartToggle")?.addEventListener("click", openCart);
$("#closeCart")?.addEventListener("click", closeCart);
$("#drawerOverlay")?.addEventListener("click", closeCart);
$("#checkoutBtn")?.addEventListener("click", () => {
  if (!state.cart.length) {
    toast("أضف منتجاً إلى السلة أولاً");
    return;
  }
  persistCart();
  window.location.href = "checkout.html";
});
$("#couponBtn")?.addEventListener("click", () => $("#couponInput")?.value.trim() ? toast("تم تطبيق كود الخصم بنجاح") : toast("اكتب كود الخصم أولاً"));
$("#searchToggle")?.addEventListener("click", () => { $("#searchPanel")?.classList.toggle("open"); $("#searchInput")?.focus(); });
$("#closeSearch")?.addEventListener("click", () => $("#searchPanel")?.classList.remove("open"));
$("#searchInput")?.addEventListener("input", (event) => { state.search = event.target.value; state.visible = 8; renderProducts(); });
$("#menuToggle")?.addEventListener("click", () => $("#mainNav")?.classList.toggle("open"));

const navLinks = document.querySelectorAll(".main-nav a");
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) => item.classList.toggle("active", item === link));
  });
});

const newsletterForm = $("#newsletterForm");
if (newsletterForm) {
  newsletterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.target.reset();
    toast("تم اشتراكك! تحقق من بريدك للعروض القادمة.");
  });
}

const langToggle = $("#langToggle");
if (langToggle) {
  langToggle.addEventListener("click", () => toast("النسخة الإنجليزية قيد الإعداد"));
}

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) target.scrollIntoView();
  });
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCart(); });

// Initialize
state.cart = getStoredCart();

(async () => {
  if (supabaseClient) {
    await syncProductsWithSupabase();
  } else {
    products = defaultProducts;
    renderProducts();
    renderCart();
  }
})();
