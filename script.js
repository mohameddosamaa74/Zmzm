import "./supabase-config.js";

const CART_STORAGE_KEY = "zmzm-cart";
const BULK_WHATSAPP_NUMBER = "201024311053";

const supabaseUrl = window.ZMZAM_SUPABASE?.url || "";
const supabaseAnonKey = window.ZMZAM_SUPABASE?.anonKey || "";
console.log("Supabase URL configured:", Boolean(supabaseUrl));
console.log("Supabase key configured:", Boolean(supabaseAnonKey));

let supabaseClient = null;

try {
  if (supabaseUrl && supabaseAnonKey && window.supabase) {
    supabaseClient = window.supabase.createClient(
      supabaseUrl,
      supabaseAnonKey
    );
  } else {
    console.error(
      "Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }
} catch (error) {
  console.error("Supabase client initialization failed:", error);
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
    type:
      row.type ||
      (row.category === "boards"
        ? "goldboard"
        : row.category === "cupcakes"
        ? "cup"
        : row.category === "packaging"
        ? "ribbon"
        : "box"),
  };
}

let products = [];
let productsLoading = true;

async function loadProductsFromSupabase() {
  if (!supabaseClient) {
    console.error("Supabase client is not available.");
    return [];
  }

  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase load failed:", error.message);
      return [];
    }

    console.log(`Loaded ${data?.length || 0} products from Supabase.`);

    return (data || []).map(normalizeProduct);
  } catch (error) {
    console.error("Supabase critical error:", error);
    return [];
  }
}

async function syncProductsWithSupabase() {
  products = [];
  productsLoading = true;
  renderProducts();
  renderCart();

  if (!supabaseClient) {
    console.error(
      "Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );

    productsLoading = false;
    renderProducts();
    renderCart();
    return;
  }

  products = await loadProductsFromSupabase();
  productsLoading = false;

  renderProducts();
  renderCart();
}

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

const state = {
  cart: [],
  filter: "all",
  search: "",
  sort: "popular",
  visible: 8,
};

const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;

const categoryLabel = {
  boards: "ألواح الكيك",
  boxes: "علب الكيك",
  cupcakes: "كب كيك",
  packaging: "تغليف",
};

const persistCart = () =>
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));

function productArt(product) {
  let image = product.image;

  if (!image && product.type === "box") {
    image = product.name.toLowerCase().includes("beige")
      ? "/assets/cake-box-beige.png"
      : "/assets/cake-box-white.png";
  }

  if (image) {
    return `<img src="${image}" alt="${product.name}" style="width:100%;height:100%;object-fit:contain;padding:10px;border-radius:18px;display:block;background:#fff;" />`;
  }

  if (
    product.type === "goldboard" ||
    product.type === "silverboard"
  ) {
    return `<div class="product-art ${product.type}"></div>`;
  }

  if (product.type === "cup") {
    return `<div class="product-art cup"><i></i><i></i><i></i></div>`;
  }

  return `<div class="product-art ${product.type}"></div>`;
}

function filteredProducts() {
  let result = products.filter((product) => {
    const matchesFilter =
      state.filter === "all" || product.category === state.filter;

    const query = state.search.toLowerCase();

    return (
      matchesFilter &&
      (!query ||
        `${product.name} ${product.meta} ${product.id}`
          .toLowerCase()
          .includes(query))
    );
  });

  if (state.sort === "low") {
    result.sort((a, b) => a.price - b.price);
  }

  if (state.sort === "high") {
    result.sort((a, b) => b.price - a.price);
  }

  if (state.sort === "new") {
    result.sort((a, b) => a.id - b.id);
  }

  return result;
}

function renderProducts() {
  const grid = $("#productGrid");

  if (!grid) return;

  const countEl = $("#resultsCount");
  const loadMore = $("#loadMore");

  if (productsLoading) {
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = '<div class="product-loading" role="status">جارٍ تحميل المنتجات...</div>';

    if (countEl) {
      countEl.textContent = "جارٍ تحميل المنتجات...";
    }

    if (loadMore) {
      loadMore.style.display = "none";
    }

    return;
  }

  grid.removeAttribute("aria-busy");

  const result = filteredProducts();
  const visible = result.slice(0, state.visible);
  const itemLabel = result.length === 1 ? "منتج" : "منتجات";

  if (countEl) {
    countEl.textContent =
      `عرض ${visible.length} من ${result.length} ${itemLabel}`;
  }

  grid.innerHTML = visible.length
    ? visible
        .map(
          (product) => `
    <article class="product-card" data-product-id="${product.id}">
      <div class="product-image ${product.category}">
        ${
          product.tag
            ? `<span class="product-badge">${product.tag}</span>`
            : ""
        }

        <button class="wish" aria-label="إضافة إلى المفضلة">
          ♡
        </button>

        <button class="quick-view" data-id="${product.id}">
          عرض سريع
        </button>

        ${productArt(product)}
      </div>

      <div class="product-info">
        <h3>${product.name}</h3>

        <div class="product-meta">
          ★ ${product.rating} &nbsp; · &nbsp; ${product.meta}
        </div>

        <div class="product-row">
          <span class="price">
            ${money(product.price)}

            ${
              product.old
                ? `<del class="old-price">${money(product.old)}</del>`
                : ""
            }
          </span>

          <button
            class="add-to-cart"
            data-id="${product.id}"
            aria-label="إضافة ${product.name} للسلة"
          >
            ＋
          </button>
        </div>
      </div>
    </article>`
        )
        .join("")
    : `
      <div class="empty-cart" style="grid-column:1/-1">
        لم نجد منتجات مطابقة لبحثك. جرّب كلمة أخرى.
      </div>
    `;

  if (loadMore) {
    loadMore.style.display =
      state.visible < result.length ? "block" : "none";

    loadMore.textContent =
      state.visible < result.length
        ? "عرض المزيد"
        : "لا توجد منتجات إضافية";
  }
}

function hasProductImage(product) {
  if (product.image) return true;
  if (product.type === "box") return true;

  return false;
}

function renderCart() {
  persistCart();

  const count = state.cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const subtotal = state.cart.reduce(
    (sum, item) =>
      sum + item.product.price * item.quantity,
    0
  );

  const shipping =
    subtotal ? (subtotal >= 500 ? 0 : 35) : 0;

  const cartCount = $("#cartCount");

  if (cartCount) {
    cartCount.textContent = count;
  }

  const drawerCount = $("#drawerCount");

  if (drawerCount) {
    drawerCount.textContent = `${count} منتجات`;
  }

  const cartItems = $("#cartItems");

  if (cartItems) {
    cartItems.innerHTML = state.cart.length
      ? state.cart
          .map(
            ({ product, quantity }) => `
      <div class="cart-item">

        <div class="cart-thumb ${
          hasProductImage(product) ? "has-image" : ""
        }">
          ${productArt(product)}
        </div>

        <div>
          <h4>${product.name}</h4>
          <small>${product.meta}</small>

          <div class="cart-controls">
            <button data-action="decrease" data-id="${product.id}">
              −
            </button>

            <span>${quantity}</span>

            <button data-action="increase" data-id="${product.id}">
              ＋
            </button>
          </div>
        </div>

        <div>
          <strong>
            ${money(product.price * quantity)}
          </strong>

          <button
            class="remove-item"
            data-action="remove"
            data-id="${product.id}"
          >
            حذف
          </button>
        </div>

      </div>`
          )
          .join("")
      : `
        <div class="empty-cart">
          سلتك فارغة حالياً
          <br />
          <small>
            أضف بعض القطع الجميلة لتبدأ.
          </small>
        </div>
      `;
  }

  const subtotalEl = $("#subtotal");

  if (subtotalEl) {
    subtotalEl.textContent = money(subtotal);
  }

  const shippingEl = $("#shipping");

  if (shippingEl) {
    shippingEl.textContent = shipping
      ? money(shipping)
      : subtotal
      ? "مجاني"
      : "—";
  }

  const totalEl = $("#total");

  if (totalEl) {
    totalEl.textContent = money(subtotal + shipping);
  }
}

function toast(message) {
  const el = $("#toast");

  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
  }, 2300);
}

function openCart() {
  $("#cartDrawer")?.classList.add("open");
  $("#drawerOverlay")?.classList.add("visible");
}

function closeCart() {
  $("#cartDrawer")?.classList.remove("open");
  $("#drawerOverlay")?.classList.remove("visible");
}

function addToCart(id) {
  const product = products.find(
    (item) => item.id === id
  );

  if (!product) return;

  const existing = state.cart.find(
    (item) => item.product.id === id
  );

  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      product,
      quantity: 1,
    });
  }

  persistCart();
  renderCart();

  toast("تمت إضافة المنتج إلى السلة");
}

$("#productGrid")?.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest(
      ".add-to-cart"
    );

    if (button) {
      const id = Number(button.dataset.id);
      addToCart(id);
      return;
    }

    if (event.target.closest(".wish")) {
      toast("تمت إضافة المنتج إلى المفضلة");
    }

    const quickView =
      event.target.closest(".quick-view");

    if (quickView) {
      const product = products.find(
        (item) =>
          item.id === Number(quickView.dataset.id)
      );

      if (!product) return;

      $("#modalContent").innerHTML = `
        <div class="modal-product">

          <div class="product-image ${product.category}">
            ${productArt(product)}
          </div>

          <div>

            <span class="kicker">
              ${categoryLabel[product.category] || "منتج"}
            </span>

            <h2>${product.name}</h2>

            <div class="product-meta">
              ★ ${product.rating}
              &nbsp; · &nbsp;
              ${product.meta}
            </div>

            <p>
              حل أنيق وعملي يحافظ على منتجك ويمنحه مظهراً
              احترافياً من لحظة التسليم وحتى أول قضمة.
            </p>

            <div class="price">
              ${money(product.price)}
            </div>

            <button
              class="btn btn-primary wide modal-add"
              data-id="${product.id}"
            >
              أضف للسلة <span>←</span>
            </button>

          </div>
        </div>
      `;

      $("#quickModal")?.classList.add("open");

      $("#modalBackdrop")?.classList.add(
        "visible"
      );
    }
  }
);

$("#modalContent")?.addEventListener(
  "click",
  (event) => {
    const pickerToggle = event.target.closest(".bulk-product-toggle");
    const picker = event.target.closest(".bulk-product-picker");

    if (pickerToggle) {
      const list = picker?.querySelector(".bulk-product-options");
      const isExpanded = pickerToggle.getAttribute("aria-expanded") === "true";

      pickerToggle.setAttribute("aria-expanded", String(!isExpanded));
      list?.classList.toggle("open", !isExpanded);
      return;
    }

    const productOption = event.target.closest(".bulk-product-option");

    if (productOption) {
      const form = productOption.closest("#bulkQuoteForm");
      const picker = productOption.closest(".bulk-product-picker");
      const selectedProduct = products.find(
        (item) => item.id === Number(productOption.dataset.id)
      );

      if (!form || !picker || !selectedProduct) return;

      form.elements.product.value = selectedProduct.id;
      picker.querySelector(".bulk-product-selected").innerHTML = `
        <span class="bulk-product-thumb">${productArt(selectedProduct)}</span>
        <span class="bulk-product-copy">
          <strong>${selectedProduct.name}</strong>
          <small>${selectedProduct.meta || categoryLabel[selectedProduct.category] || "منتج"}</small>
        </span>
      `;
      picker.querySelector(".bulk-product-toggle").setAttribute("aria-expanded", "false");
      picker.querySelector(".bulk-product-options")?.classList.remove("open");

      picker
        .querySelectorAll(".bulk-product-option")
        .forEach((option) => option.setAttribute("aria-selected", String(option === productOption)));
      return;
    }

    const button =
      event.target.closest(".modal-add");

    if (button) {
      addToCart(Number(button.dataset.id));

      $("#quickModal")?.classList.remove(
        "open"
      );

      $("#modalBackdrop")?.classList.remove(
        "visible"
      );
    }
  }
);

$("#modalContent")?.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;

    const picker = event.target.closest(".bulk-product-picker");
    const toggle = picker?.querySelector(".bulk-product-toggle");
    const list = picker?.querySelector(".bulk-product-options");

    if (toggle?.getAttribute("aria-expanded") === "true") {
      toggle.setAttribute("aria-expanded", "false");
      list?.classList.remove("open");
      toggle.focus();
      event.stopPropagation();
    }
  }
);

$("#modalContent")?.addEventListener(
  "submit",
  (event) => {
    const form = event.target.closest("#bulkQuoteForm");

    if (!form) return;

    event.preventDefault();

    const productId = Number(form.elements.product.value);
    const product = products.find(
      (item) => item.id === productId
    );
    const quantity = Number(form.quantity.value) || 1;

    if (!product) {
      toast("الرجاء اختيار منتج صحيح");
      return;
    }

    const message = [
      "طلب تسعير بالجملة من موقع زمزم",
      "",
      `المنتج: ${product.name}`,
      `الكمية: ${quantity}`,
    ].join("\n");

    const whatsappUrl = `https://wa.me/${BULK_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
    toast("تم تجهيز الطلب على الواتساب");
    closeModal();
  }
);

function openBulkQuoteModal() {
  const options = products.length
    ? products
        .map(
          (product) =>
            `<button type="button" class="bulk-product-option" role="option" aria-selected="false" data-id="${product.id}">
              <span class="bulk-product-thumb">${productArt(product)}</span>
              <span class="bulk-product-copy">
                <strong>${product.name}</strong>
                <small>${product.meta || categoryLabel[product.category] || "منتج"}</small>
              </span>
              <span class="bulk-product-price">${money(product.price)}</span>
            </button>`
        )
        .join("")
    : '<p class="bulk-products-empty">لا توجد منتجات متاحة حالياً</p>';

  $("#modalContent").innerHTML = `
    <div class="bulk-quote-modal">
      <span class="kicker">تسعير بالجملة</span>
      <h2>اطلب عرض سعر</h2>

      <form id="bulkQuoteForm" class="bulk-quote-form">
        <label class="bulk-quote-field">
          المنتج
          <input type="hidden" name="product" value="" />
          <div class="bulk-product-picker">
            <button
              type="button"
              class="bulk-product-toggle"
              aria-haspopup="listbox"
              aria-expanded="false"
              aria-label="اختر المنتج"
            >
              <span class="bulk-product-selected">اختر المنتج من القائمة</span>
              <span class="bulk-product-chevron" aria-hidden="true"></span>
            </button>
            <div class="bulk-product-options" role="listbox" aria-label="المنتجات">
              ${options}
            </div>
          </div>
        </label>

        <label class="bulk-quote-field">
          الكمية
          <input
            name="quantity"
            type="number"
            min="1"
            value="1"
            required
          />
        </label>

        <button type="submit" class="btn btn-primary wide bulk-quote-submit">
          إتمام الطلب على الواتساب <span>←</span>
        </button>
      </form>
    </div>
  `;

  $("#quickModal")?.classList.add("open");
  $("#modalBackdrop")?.classList.add("visible");
}

function closeModal() {
  $("#quickModal")?.classList.remove("open");

  $("#modalBackdrop")?.classList.remove(
    "visible"
  );
}

$("#modalClose")?.addEventListener(
  "click",
  closeModal
);

$(".bulk-quote-btn")?.addEventListener(
  "click",
  openBulkQuoteModal
);

$("#modalBackdrop")?.addEventListener(
  "click",
  closeModal
);

$("#cartItems")?.addEventListener(
  "click",
  (event) => {
    const button =
      event.target.closest("[data-action]");

    if (!button) return;

    const id = Number(button.dataset.id);

    const item = state.cart.find(
      (entry) => entry.product.id === id
    );

    if (!item) return;

    if (button.dataset.action === "increase") {
      item.quantity += 1;
    } else if (
      button.dataset.action === "decrease"
    ) {
      item.quantity -= 1;
    } else if (
      button.dataset.action === "remove"
    ) {
      state.cart = state.cart.filter(
        (entry) => entry.product.id !== id
      );
    } else {
      return;
    }

    if (item && item.quantity < 1) {
      state.cart = state.cart.filter(
        (entry) => entry.product.id !== id
      );
    }

    persistCart();
    renderCart();
  }
);

$("#filterBar")?.addEventListener(
  "click",
  (event) => {
    const button =
      event.target.closest("button");

    if (!button) return;

    state.filter = button.dataset.filter;
    state.visible = 8;

    document
      .querySelectorAll("#filterBar button")
      .forEach((item) =>
        item.classList.toggle(
          "active",
          item === button
        )
      );

    renderProducts();
  }
);

document
  .querySelectorAll("[data-filter-link]")
  .forEach((link) =>
    link.addEventListener("click", () => {
      state.filter = link.dataset.filterLink;

      const filterBtn = document.querySelector(
        `#filterBar button[data-filter="${state.filter}"]`
      );

      if (filterBtn) {
        filterBtn.click();
      }
    })
  );

$("#sortSelect")?.addEventListener(
  "change",
  (event) => {
    state.sort = event.target.value;
    renderProducts();
  }
);

$("#loadMore")?.addEventListener(
  "click",
  () => {
    state.visible += 4;
    renderProducts();
  }
);

$("#cartToggle")?.addEventListener(
  "click",
  openCart
);

$("#closeCart")?.addEventListener(
  "click",
  closeCart
);

$("#drawerOverlay")?.addEventListener(
  "click",
  closeCart
);

$("#checkoutBtn")?.addEventListener(
  "click",
  (event) => {
    if (!state.cart.length) {
      event.preventDefault();
      toast("أضف منتجاً إلى السلة أولاً");
      return;
    }

    persistCart();
  }
);

$("#couponBtn")?.addEventListener(
  "click",
  () =>
    $("#couponInput")?.value.trim()
      ? toast("تم تطبيق كود الخصم بنجاح")
      : toast("اكتب كود الخصم أولاً")
);

$("#searchToggle")?.addEventListener(
  "click",
  () => {
    $("#searchPanel")?.classList.toggle(
      "open"
    );

    $("#searchInput")?.focus();
  }
);

$("#closeSearch")?.addEventListener(
  "click",
  () =>
    $("#searchPanel")?.classList.remove(
      "open"
    )
);

$("#searchInput")?.addEventListener(
  "input",
  (event) => {
    state.search = event.target.value;
    state.visible = 8;

    renderProducts();
  }
);

$("#menuToggle")?.addEventListener(
  "click",
  () =>
    $("#mainNav")?.classList.toggle(
      "open"
    )
);

const navLinks =
  document.querySelectorAll(".main-nav a");

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) =>
      item.classList.toggle(
        "active",
        item === link
      )
    );
  });
});

const newsletterForm =
  $("#newsletterForm");

if (newsletterForm) {
  newsletterForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      event.target.reset();

      toast(
        "تم اشتراكك! تحقق من بريدك للعروض القادمة."
      );
    }
  );
}

const langToggle = $("#langToggle");

if (langToggle) {
  langToggle.addEventListener(
    "click",
    () =>
      toast(
        "النسخة الإنجليزية قيد الإعداد"
      )
  );
}

document
  .querySelectorAll("[data-scroll]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const target =
        document.querySelector(
          button.dataset.scroll
        );

      if (target) {
        target.scrollIntoView();
      }
    });
  });

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      closeCart();
      closeModal();
    }
  }
);

// Initialize
state.cart = getStoredCart();

(async () => {
  await syncProductsWithSupabase();
})();
