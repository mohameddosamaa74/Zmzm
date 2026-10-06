import { supabaseClient, supabaseConfigurationError } from "./supabase-config.js";
import { escapeHtml, normalizeDigits, safeImageUrl } from "./src/js/safe-dom.js";
import { DELIVERY_TIME_NOTE, getShippingFee } from "./src/js/shipping.js";

const CART_STORAGE_KEY = "zmzm-cart";
const CART_ITEM_LIMIT = 99;
const BULK_WHATSAPP_NUMBER = "201024311053";
const EGYPT_GOVERNORATES = [
  "القاهرة",
  "الإسكندرية",
  "بورسعيد",
  "السويس",
  "دمياط",
  "الدقهلية",
  "الشرقية",
  "القليوبية",
  "كفر الشيخ",
  "الغربية",
  "المنوفية",
  "البحيرة",
  "الإسماعيلية",
  "الجيزة",
  "بني سويف",
  "الفيوم",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
  "مطروح",
  "شمال سيناء",
  "جنوب سيناء",
];

function normalizeProduct(row) {
  const validCategories = new Set(["boards", "boxes", "cupcakes", "packaging"]);
  const validTypes = new Set(["goldboard", "silverboard", "box", "cup", "ribbon"]);
  const category = validCategories.has(row.category) ? row.category : "boxes";
  const inferredType =
    category === "boards" ? "goldboard" :
    category === "cupcakes" ? "cup" :
    category === "packaging" ? "ribbon" : "box";
  const requestedType = row.type || inferredType;

  return {
    id: Number(row.id ?? 0),
    name: String(row.name || ""),
    category,
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : 0,
    old: Number.isFinite(Number(row.old_price ?? row.old)) ? Number(row.old_price ?? row.old) : 0,
    tag: String(row.tag || ""),
    meta: String(row.meta || ""),
    rating: Number.isFinite(Number(row.rating)) ? Number(row.rating) : 4.8,
    specs: row.specs || {},
    image: String(row.image || row.image_url || row.photo || ""),
    type: validTypes.has(requestedType) ? requestedType : inferredType,
  };
}

let products = [];
let productsLoading = true;
let productsLoadError = false;
let productAvailabilityError = false;

async function loadPublicProductAvailability() {
  const { data, error } = await supabaseClient.rpc("get_public_product_availability");
  if (error) throw error;

  return new Map((data || []).map((row) => [
    Number(row.product_id),
    {
      available: typeof row.available === "boolean" ? row.available : null,
      availableQuantity: Number.isInteger(row.available_quantity)
        ? Math.max(0, row.available_quantity)
        : null,
    },
  ]));
}

function productCartQuantity(productId) {
  return state.cart.find((item) => item.product.id === productId)?.quantity || 0;
}

function productAtCartLimit(product) {
  return Number.isInteger(product.availableQuantity) &&
    productCartQuantity(product.id) >= product.availableQuantity;
}

function productAvailabilityMessage(product) {
  if (productAvailabilityError) return "تعذر التحقق من المخزون";
  if (product.available === false) return "نفد المخزون — سيتوفر قريباً";
  if (product.available === true && !Number.isInteger(product.availableQuantity)) {
    return "تعذر تحديد الكمية المتاحة";
  }
  if (productAtCartLimit(product)) return "وصلت إلى الحد المتاح في السلة";
  return "التوفر غير محدد حالياً";
}

function productAvailabilityOverlay(product) {
  const atCartLimit = productAtCartLimit(product);
  if (product.available === true && !atCartLimit) return "";
  const stateClass = product.available === false
    ? "is-out-of-stock"
    : atCartLimit
      ? "is-cart-limit-reached"
      : "availability-unknown";
  return `<span class="product-stock-overlay ${stateClass}" role="status">${productAvailabilityMessage(product)}</span>`;
}

async function loadProductsFromSupabase() {
  if (!supabaseClient) {
    productsLoadError = true;
    console.error(supabaseConfigurationError);
    return [];
  }

  try {
    let { data, error } = await supabaseClient
      .from("products")
      .select("id,name,category,price,old_price,tag,meta,image,type,specs,sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error && (error.code === "42703" || error.code === "PGRST204" || /sort_order/i.test(error.message || ""))) {
      ({ data, error } = await supabaseClient
        .from("products")
        .select("id,name,category,price,old_price,tag,meta,image,type,specs")
        .order("id", { ascending: true }));
    }

    if (error) {
      console.error("Supabase load failed:", error.message);
      productsLoadError = true;
      return [];
    }

    productsLoadError = false;
    return (data || []).map(normalizeProduct);
  } catch (error) {
    console.error("Supabase critical error:", error);
    productsLoadError = true;
    return [];
  }
}

async function syncProductsWithSupabase() {
  const cartToggle = $("#cartToggle");
  if (cartToggle) cartToggle.disabled = true;
  products = [];
  productsLoading = true;
  productsLoadError = false;
  renderProducts();

  if (!supabaseClient) {
    productsLoadError = true;
    console.error(supabaseConfigurationError);
    productsLoading = false;
    renderProducts();
    return;
  }

  products = await loadProductsFromSupabase();
  let availability = new Map();
  productAvailabilityError = false;
  if (!productsLoadError) {
    try {
      availability = await loadPublicProductAvailability();
    } catch (error) {
      console.error("تعذر التحقق من توفر المنتجات:", error);
      productAvailabilityError = true;
    }
  }
  products = products.map((product) => ({
    ...product,
    available: productAvailabilityError ? null : availability.get(product.id)?.available ?? null,
    availableQuantity: productAvailabilityError
      ? null
      : availability.get(product.id)?.availableQuantity ?? null,
  }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  state.cart = state.cart.flatMap(({ product, quantity }) => {
    const currentProduct = productsById.get(Number(product?.id));
    return currentProduct && Number.isInteger(quantity) && quantity > 0
      ? [{ product: currentProduct, quantity }]
      : [];
  });
  persistCart();
  productsLoading = false;

  renderProducts();
  renderCart();
  if (cartToggle) cartToggle.disabled = false;
}

const getStoredCart = () => {
  const saved = localStorage.getItem(CART_STORAGE_KEY);

  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed.filter((entry) =>
          entry &&
          Number.isFinite(Number(entry.product?.id)) &&
          Number.isInteger(entry.quantity) &&
          entry.quantity > 0 &&
          entry.quantity <= CART_ITEM_LIMIT
        )
      : [];
  } catch (error) {
    console.error("تعذرت قراءة السلة المحفوظة؛ سيتم فتح سلة فارغة.", error);
    return [];
  }
};

const state = {
  cart: [],
  filter: "all",
  search: "",
  sort: "default",
  visible: 8,
};

const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;

const categoryLabel = {
  boards: "قواعد كيك",
  boxes: "علب الكيك",
  cupcakes: "كب كيك",
  packaging: "تغليف",
};

const persistCart = () =>
  localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify(state.cart.map(({ product, quantity }) => ({
      product: { id: product.id },
      quantity,
    })))
  );

function productArt(product) {
  let image = safeImageUrl(product.image);

  if (!image && product.type === "box") {
    image = product.name.toLowerCase().includes("beige")
      ? `${import.meta.env.BASE_URL}assets/cake-box-beige-v2.webp`
      : `${import.meta.env.BASE_URL}assets/cake-box-white-v2.webp`;
  }

  if (image) {
    return `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;padding:10px;border-radius:18px;display:block;background:#fff;" />`;
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
    return state.filter === "all" || product.category === state.filter;
  });

  if (state.sort === "low") {
    result.sort((a, b) => a.price - b.price);
  }

  if (state.sort === "high") {
    result.sort((a, b) => b.price - a.price);
  }

  if (state.sort === "new") {
    result.sort((a, b) => b.id - a.id);
  }

  return result;
}

const categorySearchTerms = {
  boards: "boards board قاعدة قواعد كيك لوح ألواح",
  boxes: "boxes box علبة علب صندوق صناديق كيك",
  cupcakes: "cupcake cupcakes كب كيك",
  packaging: "packaging تغليف شريط ملصقات",
};

const specLabels = {
  width: "العرض",
  length: "الطول",
  height: "الارتفاع",
  diameter: "القطر",
  thickness: "السُمك",
  shape: "الشكل",
  color: "اللون",
  quantity: "الكمية",
  material: "الخامة",
  pieces: "عدد القطع",
  window: "النافذة",
  type: "النوع",
};

function productSpecEntries(product) {
  if (!product.specs || typeof product.specs !== "object" || Array.isArray(product.specs)) {
    return [];
  }

  return Object.entries(product.specs)
    .filter(([, value]) => ["string", "number"].includes(typeof value) && String(value).trim())
    .map(([key, value]) => ({
      label: specLabels[key] || key,
      value: String(value),
    }));
}

function productShoppingNote(product) {
  const notes = {
    boards: [
      "قاعدة أنيقة تكمل شكل الكيك عند التقديم.",
      "اختيار مرتب لإبراز كعكتك في المناسبات.",
      "تفصيلة عملية لعرض الكيك بشكل أجمل.",
    ],
    boxes: [
      "علبة تكمل جمال الكيك وتجعله جاهزاً للتقديم.",
      "تغليف مرتب يضيف لمسة أنيقة لمناسباتك.",
      "اختيار عملي لتجهيز الكيك وتقديمه بصورة جميلة.",
    ],
    cupcakes: [
      "ترتيب أجمل لقطع الكب كيك في مناسباتك.",
      "طريقة أنيقة لتقديم الكب كيك للضيوف.",
      "اختيار عملي يساعدك على تنسيق الكب كيك.",
    ],
    packaging: [
      "لمسة بسيطة تكمل تنسيق وتغليف طلبك.",
      "تفاصيل التغليف تضيف جمالاً لتجهيزاتك.",
      "أضف لمسة أنيقة لتغليف الحلويات والهدايا.",
    ],
  };
  const choices = notes[product.category] || notes.boxes;
  return choices[Math.abs(product.id) % choices.length];
}

function normalizeSearchText(value) {
  return normalizeDigits(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ar-EG")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matchingProducts(query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0) return [];

  return products.filter((product) => {
    const specs = productSpecEntries(product)
      .flatMap(({ label, value }) => [label, value])
      .join(" ");
    const searchableText = normalizeSearchText([
      product.name,
      product.meta,
      product.id,
      product.category,
      categorySearchTerms[product.category],
      specs,
    ].join(" "));

    return searchableText.includes(normalizedQuery) ||
      queryTerms.every((term) => searchableText.includes(term));
  });
}

function renderSearchResults() {
  const results = $("#searchResults");
  const panel = $("#searchPanel");
  if (!results || !panel) return;

  const query = state.search.trim();
  if (!panel.classList.contains("open") || !query) {
    results.innerHTML = "";
    results.classList.remove("visible");
    return;
  }

  if (productsLoading) {
    results.innerHTML = '<div class="search-results-message" role="status">جارٍ تحميل المنتجات...</div>';
  } else if (productsLoadError) {
    results.innerHTML = '<div class="search-results-message" role="alert">تعذر تحميل المنتجات حالياً.</div>';
  } else {
    const matches = matchingProducts(query);
    results.innerHTML = matches.length
      ? matches.map((product) => {
        const specifications = productSpecEntries(product);
        const detailPreview = specifications
          .slice(0, 2)
          .map(({ label, value }) => `${escapeHtml(label)}: ${escapeHtml(value)}`)
          .join(" · ") || escapeHtml(categoryLabel[product.category] || "منتج");

        return `
          <button class="search-result" type="button" role="option" aria-selected="false" data-id="${product.id}">
            <span class="search-result-image">${productArt(product)}</span>
            <span class="search-result-copy">
              <strong>${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(product.meta || categoryLabel[product.category] || "منتج")}</small>
              ${detailPreview ? `<small class="search-result-details">${detailPreview}</small>` : ""}
            </span>
            <strong class="search-result-price">${money(product.price)}</strong>
          </button>
        `;
      }).join("")
      : '<div class="search-results-message">لا توجد منتجات مطابقة. جرّب كلمة أخرى.</div>';
  }

  results.classList.add("visible");
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

    renderSearchResults();
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

  grid.innerHTML = productsLoadError
    ? '<div class="empty-cart product-load-error" role="alert">تعذر تحميل المنتجات حالياً. تحقق من الاتصال ثم أعد المحاولة.<br /><button class="btn btn-primary retry-products" type="button">إعادة المحاولة</button></div>'
    : visible.length
    ? visible
        .map((product) => {
          const atCartLimit = productAtCartLimit(product);
          const dimClass = product.available === false
            ? "is-out-of-stock"
            : atCartLimit
              ? "is-cart-limit-reached"
              : "";
          const canAddProduct = product.available === true &&
            Number.isInteger(product.availableQuantity) && !atCartLimit;
          return `
    <article class="product-card ${dimClass}" data-product-id="${product.id}">
      <div class="product-image ${product.category} ${dimClass}">
        ${
          product.tag
            ? `<span class="product-badge">${escapeHtml(product.tag)}</span>`
            : ""
        }

        ${productArt(product)}
        ${productAvailabilityOverlay(product)}
      </div>

      <div class="product-info">
        <h3>${escapeHtml(product.name)}</h3>

        <div class="product-meta">
          ${escapeHtml(product.meta)}
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
            aria-label="${canAddProduct ? `إضافة ${escapeHtml(product.name)} للسلة` : `${escapeHtml(product.name)}: ${productAvailabilityMessage(product)}`}"
            ${canAddProduct ? "" : "disabled"}
          >
            ＋
          </button>
        </div>

        <button class="product-view-button" type="button" data-id="${product.id}">
          عرض المنتج
        </button>
      </div>
    </article>`;
        })
        .join("")
    : products.length === 0
    ? '<div class="empty-cart" style="grid-column:1/-1">لا توجد منتجات متاحة حالياً.</div>'
    : `
      <div class="empty-cart" style="grid-column:1/-1">
        لم نجد منتجات مطابقة لبحثك. جرّب كلمة أخرى.
      </div>
    `;

  if (loadMore) {
    loadMore.style.display =
      !productsLoadError && state.visible < result.length ? "block" : "none";

    loadMore.textContent =
      state.visible < result.length
        ? "عرض المزيد"
        : "لا توجد منتجات إضافية";
  }

  renderSearchResults();
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

  const shipping = getShippingFee(subtotal);

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
          <h4>${escapeHtml(product.name)}</h4>
          <small>${escapeHtml(product.meta)}</small>

          <div class="cart-controls">
            <button data-action="decrease" data-id="${product.id}">
              −
            </button>

            <span>${quantity}</span>

            <button data-action="increase" data-id="${product.id}" ${!product.available || !Number.isInteger(product.availableQuantity) || quantity >= product.availableQuantity || quantity >= CART_ITEM_LIMIT ? "disabled aria-label=\"وصلت إلى الحد المتاح\"" : ""}>
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
    shippingEl.textContent = shipping === null
      ? "يُحدد حسب المحافظة"
      : shipping
      ? money(shipping)
      : subtotal
      ? "مجاني"
      : "—";
  }

  const totalEl = $("#total");

  if (totalEl) {
    totalEl.textContent = shipping === null
      ? "يُحدد عند إتمام الطلب"
      : money(subtotal + shipping);
  }

  const deliveryNote = $("#cartDeliveryNote");
  if (deliveryNote) deliveryNote.textContent = DELIVERY_TIME_NOTE;
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

const scrollLocks = new Set();
let lockedScrollPosition = 0;

function setPageScrollLock(owner, locked) {
  if (locked) {
    if (scrollLocks.has(owner)) return;
    scrollLocks.add(owner);
    if (scrollLocks.size > 1) return;

    lockedScrollPosition = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollPosition}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.classList.add("overlay-scroll-locked");
    return;
  }

  scrollLocks.delete(owner);
  if (scrollLocks.size || !document.body.classList.contains("overlay-scroll-locked")) return;

  document.body.classList.remove("overlay-scroll-locked");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  const scrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, lockedScrollPosition);
  requestAnimationFrame(() => {
    document.documentElement.style.scrollBehavior = scrollBehavior;
  });
}

function openCart() {
  $("#cartDrawer")?.classList.add("open");
  $("#drawerOverlay")?.classList.add("visible");
  setPageScrollLock("cart", true);
}

function closeCart() {
  $("#cartDrawer")?.classList.remove("open");
  $("#drawerOverlay")?.classList.remove("visible");
  setPageScrollLock("cart", false);
}

function addToCart(id) {
  const product = products.find(
    (item) => item.id === id
  );

  if (!product) return false;
  if (product.available !== true || !Number.isInteger(product.availableQuantity)) {
    toast(productAvailabilityMessage(product));
    return false;
  }

  const existing = state.cart.find(
    (item) => item.product.id === id
  );
  const currentQuantity = existing?.quantity || 0;

  if (currentQuantity >= product.availableQuantity) {
    toast("وصلت إلى الحد المتاح في السلة");
    renderProducts();
    return false;
  }

  if (existing) {
    if (existing.quantity >= CART_ITEM_LIMIT) {
      toast(`الحد الأقصى ${CART_ITEM_LIMIT} قطعة من المنتج الواحد`);
      return false;
    }
    existing.quantity += 1;
  } else {
    state.cart.push({
      product,
      quantity: 1,
    });
  }

  persistCart();
  renderCart();
  renderProducts();

  toast("تمت إضافة المنتج إلى السلة");
  return true;
}

$("#productGrid")?.addEventListener(
  "click",
  (event) => {
    if (event.target.closest(".retry-products")) {
      syncProductsWithSupabase();
      return;
    }

    const button = event.target.closest(
      ".add-to-cart"
    );

    const viewButton = event.target.closest(".product-view-button");
    if (viewButton) {
      openProductDetailsModal(Number(viewButton.dataset.id));
      return;
    }

    if (button) {
      const id = Number(button.dataset.id);
      addToCart(id);
      return;
    }

  }
);

$("#searchResults")?.addEventListener("click", (event) => {
  const resultButton = event.target.closest(".search-result");
  if (!resultButton) return;

  const productId = Number(resultButton.dataset.id);
  if (!products.some((product) => product.id === productId)) return;

  $("#searchPanel")?.classList.remove("open");
  $("#searchToggle")?.setAttribute("aria-expanded", "false");
  $("#searchToggle")?.setAttribute("aria-label", "فتح البحث");
  state.search = "";
  state.filter = "all";
  state.visible = products.length;
  $("#searchInput").value = "";
  document.querySelectorAll("#filterBar button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
  });
  renderSearchResults();
  renderProducts();
  requestAnimationFrame(() => {
    document.querySelector(`[data-product-id="${productId}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
});

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

      const quoteItem = productOption.closest(".bulk-quote-item");
      if (!quoteItem) return;
      quoteItem.dataset.productId = String(selectedProduct.id);
      picker.querySelector(".bulk-product-selected").innerHTML = `
        <span class="bulk-product-thumb">${productArt(selectedProduct)}</span>
        <span class="bulk-product-copy">
          <strong>${escapeHtml(selectedProduct.name)}</strong>
          <small>${escapeHtml(selectedProduct.meta || categoryLabel[selectedProduct.category] || "منتج")}</small>
        </span>
      `;
      picker.querySelector(".bulk-product-toggle").setAttribute("aria-expanded", "false");
      picker.querySelector(".bulk-product-options")?.classList.remove("open");
      updateBulkQuoteItems(form);
      return;
    }

    if (event.target.closest(".bulk-add-item")) {
      const form = event.target.closest("#bulkQuoteForm");
      const itemsContainer = form?.querySelector(".bulk-quote-items");
      if (!form || !itemsContainer) return;
      itemsContainer.insertAdjacentHTML("beforeend", createBulkQuoteItem());
      updateBulkQuoteItems(form);
      itemsContainer.lastElementChild?.querySelector(".bulk-product-toggle")?.focus();
      return;
    }

    if (event.target.closest(".bulk-remove-item")) {
      const form = event.target.closest("#bulkQuoteForm");
      const quoteItem = event.target.closest(".bulk-quote-item");
      if (!form || !quoteItem) return;

      quoteItem.remove();
      if (!form.querySelector(".bulk-quote-item")) {
        form.querySelector(".bulk-quote-items").innerHTML = createBulkQuoteItem();
      }
      updateBulkQuoteItems(form);
      return;
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
  "input",
  (event) => {
    const phoneInput = event.target.closest(
      '#bulkQuoteForm input[name="phone"]'
    );

    if (phoneInput) {
      phoneInput.value = normalizeDigits(phoneInput.value).replace(/\D/g, "").slice(0, 11);
    }
  }
);

$("#modalContent")?.addEventListener(
  "submit",
  (event) => {
    const form = event.target.closest("#bulkQuoteForm");

    if (!form) return;

    event.preventDefault();

    const quoteItems = [...form.querySelectorAll(".bulk-quote-item")].map((row) => ({
      product: products.find((item) => item.id === Number(row.dataset.productId)),
      quantity: Number(row.querySelector('[name="quantity"]').value),
    }));
    const phone = normalizeDigits(form.elements.phone.value).replace(/\D/g, "");
    const firstName = form.elements.firstName.value.trim();
    const lastName = form.elements.lastName.value.trim();

    if (!quoteItems.length || quoteItems.some(({ product, quantity }) =>
      !product || !Number.isSafeInteger(quantity) || quantity < 1
    )) {
      toast("اختر كل المنتجات وأدخل كمية صحيحة لكل منتج");
      return;
    }

    if (!/^01[0125][0-9]{8}$/.test(phone)) {
      toast("أدخل رقم هاتف مصري صحيحاً مكوناً من 11 رقماً");
      form.elements.phone.focus();
      return;
    }

    if (!firstName || !lastName) {
      toast("يرجى إدخال الاسم الأول واسم العائلة");
      return;
    }

    const message = [
      "طلب تسعير بالجملة من موقع زمزم",
      "",
      `الاسم: ${firstName} ${lastName}`,
      `الهاتف: ${phone}`,
      `المحافظة: ${form.elements.governorate.value}`,
      "المنتجات والكميات:",
      ...quoteItems.map(({ product, quantity }, index) =>
        `${index + 1}. ${product.name} — الكمية: ${quantity}`
      ),
    ].join("\n");

    const whatsappUrl = `https://wa.me/${BULK_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
    toast("تم تجهيز الطلب على الواتساب");
    closeModal();
  }
);

function createBulkQuoteItem() {
  return `
    <div class="bulk-quote-item" data-product-id="">
      <div class="bulk-product-picker">
        <button type="button" class="bulk-product-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="اختر المنتج">
          <span class="bulk-product-selected">اختر المنتج من القائمة</span>
          <span class="bulk-product-chevron" aria-hidden="true"></span>
        </button>
        <div class="bulk-product-options" role="listbox" aria-label="المنتجات">
          ${products.map((product) =>
            `<button type="button" class="bulk-product-option" role="option" aria-selected="false" data-id="${product.id}">
              <span class="bulk-product-thumb">${productArt(product)}</span>
              <span class="bulk-product-copy">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.meta || categoryLabel[product.category] || "منتج")}</small>
              </span>
              <span class="bulk-product-price">${money(product.price)}</span>
            </button>`
          ).join("")}
        </div>
      </div>
      <div class="bulk-quote-item-controls">
        <label class="bulk-quote-field">
          الكمية
          <input name="quantity" type="number" min="1" step="1" value="1" required />
        </label>
        <button type="button" class="bulk-remove-item" aria-label="حذف المنتج">حذف</button>
      </div>
    </div>
  `;
}

function updateBulkQuoteItems(form) {
  const rows = [...form.querySelectorAll(".bulk-quote-item")];
  const selectedIds = new Set(
    rows
      .map((row) => row.dataset.productId)
      .filter(Boolean)
      .map(Number)
  );

  rows.forEach((row) => {
    const productId = Number(row.dataset.productId);
    row.querySelectorAll(".bulk-product-option").forEach((option) => {
      const isSelected = Number(option.dataset.id) === productId;
      const selectedElsewhere = selectedIds.has(Number(option.dataset.id)) && !isSelected;
      option.disabled = selectedElsewhere;
      option.setAttribute("aria-selected", String(isSelected));
    });
  });

  const addButton = form.querySelector(".bulk-add-item");
  if (addButton) {
    const allProductsSelected = selectedIds.size >= products.length;
    addButton.disabled = allProductsSelected;
    addButton.setAttribute("aria-disabled", String(allProductsSelected));
  }
}

function openBulkQuoteModal() {
  const initialItem = products.length
    ? createBulkQuoteItem()
    : '<p class="bulk-products-empty">لا توجد منتجات متاحة حالياً</p>';
  const addItemButton = products.length
    ? '<button type="button" class="bulk-add-item">＋ إضافة منتج آخر</button>'
    : "";

  const governorateOptions = EGYPT_GOVERNORATES
    .map((governorate) => `<option value="${governorate}">${governorate}</option>`)
    .join("");

  $("#modalContent").innerHTML = `
    <div class="bulk-quote-modal">
      <span class="kicker">تسعير بالجملة</span>
      <h2>اطلب عرض سعر</h2>

      <form id="bulkQuoteForm" class="bulk-quote-form">
        <div class="bulk-quote-contact-grid">
          <label class="bulk-quote-field">
            الاسم الأول
            <input name="firstName" type="text" autocomplete="given-name" required />
          </label>

          <label class="bulk-quote-field">
            الاسم الأخير
            <input name="lastName" type="text" autocomplete="family-name" required />
          </label>

          <label class="bulk-quote-field">
            رقم الهاتف
            <input
              name="phone"
              type="tel"
              inputmode="numeric"
              autocomplete="tel-national"
              placeholder="01012345678"
              pattern="01[0125][0-9]{8}"
              maxlength="11"
              title="أدخل رقم هاتف مصرياً صحيحاً مكوناً من 11 رقماً"
              required
            />
          </label>

          <label class="bulk-quote-field">
            المحافظة
            <select name="governorate" autocomplete="address-level1" required>
              <option value="">اختر المحافظة</option>
              ${governorateOptions}
            </select>
          </label>
        </div>

        <div class="bulk-quote-items" aria-label="المنتجات المطلوبة">
          ${initialItem}
        </div>
        ${addItemButton}

        <button type="submit" class="btn btn-primary wide bulk-quote-submit">
          إتمام الطلب على الواتساب <span>←</span>
        </button>
      </form>
    </div>
  `;

  $("#quickModal")?.classList.remove("product-details-open");
  $("#quickModal")?.setAttribute("aria-label", "طلب عرض سعر بالجملة");
  $("#quickModal")?.classList.add("open");
  setPageScrollLock("modal", true);
  $("#modalBackdrop")?.classList.add("visible");
}

function openProductDetailsModal(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const specs = productSpecEntries(product)
    .map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  const canAddProduct = product.available === true &&
    Number.isInteger(product.availableQuantity) && !productAtCartLimit(product);

  $("#modalContent").innerHTML = `
    <article class="product-detail-view">
      <div class="product-detail-image product-image ${escapeHtml(product.category)} ${product.available === false ? "is-out-of-stock" : ""}">
        ${productArt(product)}
        ${productAvailabilityOverlay(product)}
      </div>
      <div class="product-detail-copy">
        <span class="product-detail-category">${escapeHtml(categoryLabel[product.category] || "منتج")}</span>
        <h2 class="product-detail-title">${escapeHtml(product.name)}</h2>
        <p class="product-detail-description">${escapeHtml(product.meta || (specs ? "تفاصيل المنتج والمقاسات موضحة أدناه." : "لا توجد تفاصيل إضافية لهذا المنتج."))}</p>
        <aside class="product-detail-highlight">
          <span class="product-detail-highlight-icon" aria-hidden="true">✦</span>
          <div>
            <strong>فكرة للاستخدام</strong>
            <p>${escapeHtml(productShoppingNote(product))}</p>
          </div>
        </aside>
        ${specs ? `<dl class="product-detail-specs">${specs}</dl>` : ""}
        <div class="product-detail-purchase">
          <span class="product-detail-price">${money(product.price)}</span>
          <button class="btn btn-primary product-detail-add" type="button" data-id="${product.id}" ${canAddProduct ? "" : "disabled"}>
            ${canAddProduct ? "أضف إلى السلة" : escapeHtml(productAvailabilityMessage(product))}
          </button>
        </div>
      </div>
    </article>
  `;

  $("#quickModal")?.classList.add("product-details-open", "open");
  $("#quickModal")?.setAttribute("aria-label", `عرض المنتج ${product.name}`);
  setPageScrollLock("modal", true);
  $("#modalBackdrop")?.classList.add("visible");
}

$("#quickModal")?.addEventListener("click", (event) => {
  const button = event.target.closest(".product-detail-add");
  if (!button || button.disabled) return;
  if (addToCart(Number(button.dataset.id))) closeModal();
});

function closeModal() {
  $("#quickModal")?.classList.remove("open");
  $("#quickModal")?.classList.remove("product-details-open");
  $("#quickModal")?.setAttribute("aria-label", "طلب عرض سعر بالجملة");

  $("#modalBackdrop")?.classList.remove(
    "visible"
  );
  setPageScrollLock("modal", false);
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
      if (item.product.available !== true || !Number.isInteger(item.product.availableQuantity) || item.quantity >= item.product.availableQuantity) {
        toast("وصلت إلى الحد المتاح في المخزون");
        return;
      }
      if (item.quantity >= CART_ITEM_LIMIT) {
        toast(`الحد الأقصى ${CART_ITEM_LIMIT} قطعة من المنتج الواحد`);
        return;
      }
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
    renderProducts();
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
    document.getElementById("shop").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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
    const panel = $("#searchPanel");
    const isOpen = panel?.classList.toggle("open") ?? false;
    $("#searchToggle")?.setAttribute("aria-expanded", String(isOpen));
    $("#searchToggle")?.setAttribute("aria-label", isOpen ? "إغلاق البحث" : "فتح البحث");
    renderSearchResults();
    $("#searchInput")?.focus();
  }
);

$("#closeSearch")?.addEventListener(
  "click",
  () => {
    $("#searchPanel")?.classList.remove(
      "open"
    );
    $("#searchToggle")?.setAttribute("aria-expanded", "false");
    $("#searchToggle")?.setAttribute("aria-label", "فتح البحث");
    renderSearchResults();
  }
);

$("#searchInput")?.addEventListener(
  "input",
  (event) => {
    state.search = event.target.value;
    renderSearchResults();
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
    $("#mainNav")?.classList.remove("open");
    $("#menuToggle")?.setAttribute("aria-expanded", "false");
  });
});

document.querySelectorAll('a[href="#home"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (location.hash !== "#home") history.pushState(null, "", "#home");
    const scrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = scrollBehavior;
    });
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
