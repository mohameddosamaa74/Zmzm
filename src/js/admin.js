import { supabaseClient, supabaseConfigurationError } from "../../supabase-config.js";
import { escapeHtml, normalizeDigits, safeImageUrl } from "./safe-dom.js";
import { usernameToAuthEmail } from "./admin-auth.js";

const PRODUCT_FIELDS = "id,name,category,price,old_price,tag,meta,rating,specs,image,type";
const PRODUCT_IMAGE_BUCKET = "zmzm-product-images";
const MAX_PRODUCT_IMAGE_SIZE = 10 * 1024 * 1024;
const categoryNames = {
  boards: "قواعد كيك",
  boxes: "علب الكيك",
  cupcakes: "كب كيك",
  packaging: "تغليف",
};

const productForm = document.getElementById("productForm");
const productTableBody = document.getElementById("productTableBody");
const toast = document.getElementById("toast");
const formTitle = document.getElementById("formTitle");
const loginForm = document.getElementById("loginForm");
const authScreen = document.getElementById("authScreen");
const adminShell = document.getElementById("adminShell");
const menuToggle = document.getElementById("menuToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const adminNavigation = document.getElementById("adminNavigation");
const productDialog = document.getElementById("productDialog");
const orderDetailsDialog = document.getElementById("orderDetailsDialog");
const orderReturnDialog = document.getElementById("orderReturnDialog");
const statusWhatsAppDialog = document.getElementById("statusWhatsAppDialog");
const inventoryDialog = document.getElementById("inventoryDialog");
const accountEntryDialog = document.getElementById("accountEntryDialog");
const inquiryDetailsDialog = document.getElementById("inquiryDetailsDialog");
const logoutBtn = document.getElementById("logoutBtn");
const productImageInput = document.getElementById("productImage");
const productImagePreview = document.getElementById("productImagePreview");
const imagePreviewText = document.getElementById("imagePreviewText");
const currentImageInput = document.getElementById("currentImage");
let products = [];
let orders = [];
let inventoryRows = [];
let productInquiries = [];
let selectedInquiry = null;
let isAdmin = false;
let productReorderBusy = false;
let draggedProductId = null;
let productOrderingEnabled = false;
let returnOrder = null;
let returnRequestKey = "";
const ORDERS_PAGE_SIZE = 50;
let ordersPage = 0;
let ordersTotalCount = 0;
const INQUIRY_PAGE_SIZE = 50;
let inquiriesPage = 0;
let inquiriesTotalCount = 0;
const ORDER_STATUSES = {
  pending: "جديد",
  confirmed: "تم التأكيد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};
const ORDER_STATUS_MESSAGES = {
  confirmed: "تم تأكيد طلبك.",
  processing: "بدأنا تجهيز طلبك.",
  shipped: "تم شحن طلبك، وهو في الطريق إليك.",
  delivered: "تم تسليم طلبك.",
  cancelled: "تم إلغاء طلبك.",
};
const INVENTORY_MOVEMENT_LABELS = {
  opening: "جرد افتتاحي",
  received: "استلام كمية",
  issued: "صرف كمية",
  returned: "مرتجع صالح",
  return_damaged: "مرتجع تالف",
  damaged: "تالف",
  count: "تعديل بعد الجرد",
  reserved: "حجز طلب",
  released: "تحرير حجز",
  shipped: "شحن طلب",
};
const ACCOUNT_CATEGORY_LABELS = {
  order_collection: "تحصيل طلب",
  delivered_order: "قيمة منتجات طلب مُسلّم",
  sales_return: "مردودات المبيعات",
  order_return_refund: "مردودات المبيعات",
  other_income: "دخل آخر",
  inventory_purchase: "شراء مخزون",
  shipping: "شحن وتوصيل",
  operating: "مصروفات تشغيلية",
  other_expense: "مصروف آخر",
};
const ACCOUNT_CATEGORY_OPTIONS = {
  income: [
    ["order_collection", "تحصيل طلب"],
    ["other_income", "دخل آخر"],
  ],
  expense: [
    ["inventory_purchase", "شراء مخزون"],
    ["shipping", "شحن وتوصيل"],
    ["operating", "مصروفات تشغيلية"],
    ["other_expense", "مصروف آخر"],
  ],
};
const PAYMENT_METHOD_LABELS = {
  cash: "نقدي",
  bank_transfer: "تحويل بنكي",
  mobile_wallet: "محفظة إلكترونية",
  other: "أخرى",
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;
}

function getOrderStatusLabel(status) {
  return ORDER_STATUSES[status] || status || "—";
}

function renderOrderStatusOptions(order) {
  const currentStatus = String(order.status || "");
  const unknownOption = ORDER_STATUSES[currentStatus]
    ? ""
    : `<option value="${escapeHtml(currentStatus)}" selected disabled>حالة غير معروفة</option>`;
  const allowedStatuses = {
    pending: ["pending", "confirmed", "cancelled"],
    confirmed: ["confirmed", "processing", "shipped", "cancelled"],
    processing: ["processing", "shipped", "cancelled"],
    shipped: ["shipped", "delivered"],
    delivered: ["delivered"],
    cancelled: ["cancelled", "confirmed"],
  }[currentStatus] || [currentStatus];

  return `${unknownOption}${allowedStatuses.map((value) => [value, ORDER_STATUSES[value]])
    .filter(([, label]) => Boolean(label)).map(([value, label]) =>
    `<option value="${value}" ${currentStatus === value ? "selected" : ""}>${label}</option>`
  ).join("")}`;
}

function normalizeProduct(row) {
  return {
    ...row,
    id: Number(row.id),
    name: String(row.name || ""),
    category: categoryNames[row.category] ? row.category : "boxes",
    price: Number(row.price),
    purchaseCost: row.purchaseCost == null ? null : Number(row.purchaseCost),
    old: Number(row.old_price || 0),
    tag: String(row.tag || ""),
    meta: String(row.meta || ""),
    rating: Number(row.rating || 4.8),
    specs: row.specs || {},
    image: String(row.image || ""),
    type: String(row.type || "box"),
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : Number(row.id || 0),
  };
}

function isMissingProductSortColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" ||
    message.includes("sort_order");
}

function updateAuthUI() {
  authScreen.classList.toggle("hidden", isAdmin);
  adminShell.classList.toggle("hidden", !isAdmin);
  setMenuOpen(false);
}

function setMenuOpen(isOpen) {
  adminShell.classList.toggle("menu-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "إغلاق قائمة التنقل" : "فتح قائمة التنقل");
  adminNavigation.setAttribute("aria-hidden", String(!isOpen));
  adminNavigation.inert = !isOpen;
}

function showAdminView(view) {
  const views = {
    dashboard: { element: document.getElementById("dashboardView"), title: "نظرة سريعة" },
    products: { element: document.getElementById("products"), title: "المنتجات" },
    orders: { element: document.getElementById("orders"), title: "الطلبات" },
    inventory: { element: document.getElementById("inventory"), title: "المخزن" },
    accounts: { element: document.getElementById("accounts"), title: "الحسابات" },
    inquiries: { element: document.getElementById("inquiries"), title: "استفسارات المنتجات" },
    analytics: { element: document.getElementById("analytics"), title: "تحليلات الأعمال" },
  };
  const selectedView = views[view] || views.dashboard;
  for (const [name, item] of Object.entries(views)) {
    item.element.classList.toggle("hidden", item !== selectedView);
    adminNavigation.querySelector(`[href="#${name}"]`)?.classList.toggle("active", item === selectedView);
  }
  document.querySelector(".topbar h1").textContent = selectedView.title;
  if (view === "dashboard") {
    ordersPage = 0;
    loadOrders({ page: 0 });
  } else if (view === "orders") {
    loadOrders({ page: ordersPage });
  } else if (view === "inventory") {
    loadInventory();
  } else if (view === "accounts") {
    loadAccounts();
  } else if (view === "inquiries") {
    loadInquiries();
  } else if (view === "analytics") {
    loadBusinessAnalytics();
  }
}

function renderStats() {
  document.getElementById("totalProducts").textContent = String(products.length);
  document.getElementById("boardsCount").textContent = String(products.filter((item) => item.category === "boards").length);
  document.getElementById("boxesCount").textContent = String(products.filter((item) => item.category === "boxes").length);
  document.getElementById("packagingCount").textContent = String(products.filter((item) => item.category === "packaging").length);
}

function getCurrentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function getTodayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatAdminDate(value, includeTime = false) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ar-EG", includeTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "medium" });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("ar-EG");
}

function getInventoryStatus(row) {
  if (!row.is_initialized) return { label: "بحاجة إلى جرد", className: "inventory-status-uninitialized" };
  const available = row.on_hand - row.reserved;
  if (available <= 0) return { label: "نفد المخزون", className: "inventory-status-empty" };
  if (available <= row.reorder_level) return { label: "مخزون منخفض", className: "inventory-status-low" };
  return { label: "متوفر", className: "inventory-status-ok" };
}

function renderInventory() {
  const initializedRows = inventoryRows.filter((row) => row.is_initialized);
  const availableUnits = initializedRows.reduce((sum, row) => sum + row.on_hand - row.reserved, 0);
  const reservedUnits = initializedRows.reduce((sum, row) => sum + row.reserved, 0);
  const lowStockRows = initializedRows.filter((row) => row.on_hand - row.reserved <= row.reorder_level);

  document.getElementById("inventoryTrackedProducts").textContent = formatCount(initializedRows.length);
  document.getElementById("inventoryTrackedCaption").textContent = `من ${formatCount(inventoryRows.length)} منتج`;
  document.getElementById("inventoryAvailableUnits").textContent = formatCount(availableUnits);
  document.getElementById("inventoryLowStockProducts").textContent = formatCount(lowStockRows.length);
  document.getElementById("inventoryReservedUnits").textContent = formatCount(reservedUnits);

  const rows = inventoryRows.map((row) => {
    const available = row.is_initialized ? row.on_hand - row.reserved : null;
    const status = getInventoryStatus(row);
    return `
      <tr>
        <td><strong>${escapeHtml(row.productName)}</strong><small>${escapeHtml(categoryNames[row.category] || row.category || "")}</small></td>
        <td>${row.is_initialized ? formatCount(row.on_hand) : "—"}</td>
        <td>${row.is_initialized ? formatCount(row.reserved) : "—"}</td>
        <td>${available === null ? "—" : formatCount(available)}</td>
        <td>${formatCount(row.reorder_level)}</td>
        <td><span class="inventory-status ${status.className}">${status.label}</span></td>
        <td><button class="btn btn-secondary" type="button" data-inventory-action="edit" data-product-id="${row.product_id}">${row.is_initialized ? "تسجيل حركة" : "إدخال الرصيد"}</button></td>
      </tr>
    `;
  }).join("");
  document.getElementById("inventoryTableBody").innerHTML = rows;
  document.getElementById("inventoryEmpty").classList.toggle("hidden", inventoryRows.length > 0);
}

function formatMovementChange(movement) {
  const delta = Number(movement.quantity_delta || 0);
  if (delta > 0) return `<span class="movement-increase">+${formatCount(delta)}</span>`;
  if (delta < 0) return `<span class="movement-decrease">${formatCount(delta)}</span>`;
  if (movement.movement_type === "return_damaged") return `<span>تالف ${formatCount(movement.quantity_recorded)}</span>`;
  const reservedDelta = Number(movement.reserved_delta || 0);
  if (reservedDelta > 0) return `<span>حجز ${formatCount(reservedDelta)}</span>`;
  if (reservedDelta < 0) return `<span>تحرير ${formatCount(Math.abs(reservedDelta))}</span>`;
  return "٠";
}

function renderInventoryMovements(movements) {
  const body = document.getElementById("inventoryMovementsBody");
  body.innerHTML = movements.map((movement) => `
    <tr>
      <td>${escapeHtml(formatAdminDate(movement.created_at, true))}</td>
      <td><strong>${escapeHtml(movement.product_name_snapshot)}</strong></td>
      <td>${escapeHtml(INVENTORY_MOVEMENT_LABELS[movement.movement_type] || movement.movement_type)}</td>
      <td>${formatMovementChange(movement)}</td>
      <td>${escapeHtml(movement.notes || "—")}</td>
    </tr>
  `).join("");
  document.getElementById("inventoryMovementsEmpty").classList.toggle("hidden", movements.length > 0);
}

async function loadInventory() {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  try {
    const monthStart = getCurrentMonthStart();
    const [stockResult, productResult, movementResult, summaryResult] = await Promise.all([
      supabaseClient.from("inventory_stock")
        .select("product_id,on_hand,reserved,reorder_level,is_initialized,updated_at")
        .order("product_id", { ascending: true }),
      supabaseClient.from("products").select("id,name,category").order("id", { ascending: true }),
      supabaseClient.from("inventory_movements")
        .select("id,product_name_snapshot,movement_type,quantity_delta,reserved_delta,quantity_recorded,created_at,notes")
        .order("created_at", { ascending: false }).limit(20),
      supabaseClient.rpc("get_inventory_month_summary", { p_month_start: monthStart }),
    ]);
    if (stockResult.error) throw stockResult.error;
    if (productResult.error) throw productResult.error;
    if (movementResult.error) throw movementResult.error;
    if (summaryResult.error) throw summaryResult.error;

    const productById = new Map((productResult.data || []).map((product) => [Number(product.id), product]));
    inventoryRows = (stockResult.data || []).map((row) => {
      const product = productById.get(Number(row.product_id));
      return {
        ...row,
        product_id: Number(row.product_id),
        on_hand: Number(row.on_hand),
        reserved: Number(row.reserved),
        reorder_level: Number(row.reorder_level),
        productName: product?.name || "منتج محذوف",
        category: product?.category || "",
      };
    });
    renderInventory();
    renderInventoryMovements(movementResult.data || []);

    const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    const movementSummary = summary || { movement_count: 0, units_received: 0, units_issued: 0 };
    document.getElementById("inventoryMonthSummary").textContent =
      `هذا الشهر: ${formatCount(movementSummary.movement_count)} حركة، ${formatCount(movementSummary.units_received)} وحدة دخلت، ${formatCount(movementSummary.units_issued)} وحدة صُرفت`;
  } catch (error) {
    console.error("تعذر تحميل بيانات المخزن.", error);
    showToast("تعذر تحميل المخزن. شغّل إعداد قاعدة بيانات المخزن والحسابات في Supabase.");
  }
}

function syncInventoryMovementOptions() {
  const productId = Number(document.getElementById("inventoryProduct").value);
  const product = inventoryRows.find((row) => row.product_id === productId);
  const typeSelect = document.getElementById("inventoryMovementType");
  const openingOption = typeSelect.querySelector('option[value="opening"]');
  const otherOptions = [...typeSelect.options].filter((option) => option.value !== "opening");
  const isInitialized = Boolean(product?.is_initialized);

  openingOption.disabled = isInitialized;
  for (const option of otherOptions) option.disabled = !isInitialized;
  if (!isInitialized) typeSelect.value = "opening";
  else if (typeSelect.value === "opening") typeSelect.value = "count";

  const exactCount = ["opening", "count"].includes(typeSelect.value);
  document.getElementById("inventoryQuantityLabel").textContent = exactCount ? "الكمية الفعلية" : "الكمية";
  const hint = !isInitialized
    ? "أدخل العدد الموجود فعلياً كبداية. لا توجد أرصدة مخزون سابقة مسجلة."
    : typeSelect.value === "count"
      ? "أدخل العدد الفعلي بعد الجرد؛ سيُسجل الفرق في سجل الحركة."
      : "أدخل عدد الوحدات في هذه الحركة. لا يمكن صرف كمية محجوزة أو أكبر من المتاح.";
  document.getElementById("inventoryMovementHint").textContent = hint;
}

function openInventoryDialog(productId = null) {
  if (!inventoryRows.length) {
    showToast("أضف منتجاً أولاً قبل تسجيل المخزون.");
    return;
  }
  const productSelect = document.getElementById("inventoryProduct");
  productSelect.innerHTML = inventoryRows.map((row) =>
    `<option value="${row.product_id}">${escapeHtml(row.productName)}</option>`
  ).join("");
  productSelect.value = String(productId || inventoryRows[0].product_id);
  document.getElementById("inventoryMovementNotes").value = "";
  const selected = inventoryRows.find((row) => row.product_id === Number(productSelect.value));
  document.getElementById("inventoryQuantity").value = selected?.is_initialized ? "" : "0";
  document.getElementById("inventoryReorderLevel").value = String(selected?.reorder_level || 0);
  document.getElementById("inventoryMovementType").value = selected?.is_initialized ? "count" : "opening";
  syncInventoryMovementOptions();
  inventoryDialog.showModal();
}

function inventoryErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("INVENTORY_ALREADY_INITIALIZED")) return "تم تسجيل الرصيد الافتتاحي لهذا المنتج بالفعل.";
  if (message.includes("INVENTORY_OPENING_REQUIRED")) return "سجّل الرصيد الافتتاحي للمنتج أولاً.";
  if (message.includes("INVENTORY_INSUFFICIENT_AVAILABLE")) return "الكمية المطلوبة أكبر من المخزون المتاح غير المحجوز.";
  if (message.includes("INVENTORY_COUNT_BELOW_RESERVED")) return "الكمية الفعلية لا يمكن أن تكون أقل من الكمية المحجوزة للطلبات.";
  if (message.includes("INVENTORY_NOT_AUTHORIZED")) return "حسابك غير مصرح له بتسجيل حركات المخزن.";
  return "تعذر حفظ حركة المخزن. تحقق من البيانات وحاول مرة أخرى.";
}

function renderTable() {
  const orderHint = document.querySelector(".product-sort-hint");
  if (orderHint) {
    orderHint.textContent = productOrderingEnabled
      ? "اسحب مقبض الترتيب بجوار المنتج لتغيير مكانه. سيظهر الترتيب نفسه في المتجر."
      : "لتفعيل ترتيب المنتجات، شغّل ملف تحديث ترتيب المنتجات في Supabase أولاً.";
  }
  productTableBody.innerHTML = products.map((product, index) => `
    <tr data-product-row="${product.id}">
      <td class="product-sort-cell">
        <button class="product-drag-handle" type="button" draggable="${productOrderingEnabled}" data-sort-handle data-id="${product.id}" aria-label="اسحب لترتيب ${escapeHtml(product.name)}" ${productOrderingEnabled ? "" : "disabled"}>⠿</button>
        <span class="product-position">${index + 1}</span>
        <span class="product-sort-buttons">
          <button class="product-sort-step" type="button" data-action="move-up" data-id="${product.id}" aria-label="تحريك ${escapeHtml(product.name)} للأعلى" ${index === 0 || productReorderBusy || !productOrderingEnabled ? "disabled" : ""}>↑</button>
          <button class="product-sort-step" type="button" data-action="move-down" data-id="${product.id}" aria-label="تحريك ${escapeHtml(product.name)} للأسفل" ${index === products.length - 1 || productReorderBusy || !productOrderingEnabled ? "disabled" : ""}>↓</button>
        </span>
      </td>
      <td><strong>${escapeHtml(product.name)}</strong></td>
      <td>${escapeHtml(categoryNames[product.category] || product.category)}</td>
      <td>${formatMoney(product.price)}</td>
      <td>${product.purchaseCost === null ? "غير مسجل" : formatMoney(product.purchaseCost)}</td>
      <td>${product.purchaseCost === null
        ? "—"
        : `<span class="${product.price - product.purchaseCost < 0 ? "product-profit-negative" : "product-profit-positive"}">${formatMoney(product.price - product.purchaseCost)}</span>`}</td>
      <td>${escapeHtml(product.rating)}</td>
      <td>
        <div class="action-group">
          <button class="icon-btn" type="button" data-action="edit" data-id="${product.id}" aria-label="تعديل المنتج">✎</button>
          <button class="icon-btn delete" type="button" data-action="delete" data-id="${product.id}" aria-label="حذف المنتج">✕</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderStats();
}

async function saveProductOrder(productIds) {
  if (productReorderBusy || !supabaseClient) return;
  if (!productOrderingEnabled) {
    showToast("شغّل تحديث ترتيب المنتجات في Supabase أولاً.");
    renderTable();
    return;
  }
  const currentIds = products.map((product) => product.id);
  const currentIdSet = new Set(currentIds);
  if (productIds.length !== currentIds.length || new Set(productIds).size !== currentIds.length ||
      productIds.some((id) => !currentIdSet.has(id))) {
    renderTable();
    return;
  }

  productReorderBusy = true;
  productTableBody.classList.add("is-saving-order");
  try {
    const { error } = await supabaseClient.rpc("reorder_products", { p_product_ids: productIds });
    if (error) throw error;

    const productsById = new Map(products.map((product) => [product.id, product]));
    products = productIds.map((id, index) => ({ ...productsById.get(id), sortOrder: index }));
    showToast("تم حفظ ترتيب المنتجات");
  } catch (error) {
    console.error("تعذر حفظ ترتيب المنتجات.", error);
    showToast(error?.code === "PGRST202" || error?.code === "42883"
      ? "شغّل تحديث ترتيب المنتجات في Supabase أولاً."
      : "تعذر حفظ الترتيب. أعد المحاولة بعد قليل.");
  } finally {
    productReorderBusy = false;
    productTableBody.classList.remove("is-saving-order");
    renderTable();
  }
}

function setImagePreview(source) {
  const safeSource = safeImageUrl(source);
  productImagePreview.src = safeSource;
  productImagePreview.classList.toggle("hidden", !safeSource);
  imagePreviewText.textContent = safeSource ? "تم تحديد الصورة" : "لا توجد صورة محددة";
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("فشل في قراءة الصورة"));
    reader.readAsDataURL(file);
  });
}

async function uploadProductImage(imageDataUrl) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
  if (!match) throw new Error("بيانات صورة المنتج غير صالحة.");
  const [, contentType, base64Data] = match;
  const binaryData = atob(base64Data);
  const imageBytes = new Uint8Array(binaryData.length);
  for (let index = 0; index < binaryData.length; index += 1) {
    imageBytes[index] = binaryData.charCodeAt(index);
  }
  const blob = new Blob([imageBytes], { type: contentType.toLowerCase() });
  const extension = extensions[contentType.toLowerCase()];
  if (!extension) throw new Error("صيغة الصورة غير مدعومة.");
  if (blob.size > MAX_PRODUCT_IMAGE_SIZE) throw new Error("يجب ألا يتجاوز حجم الصورة 10 ميجابايت.");

  const path = `products/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseClient.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, blob, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabaseClient.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

async function loadProducts() {
  const [orderedProductsResult, costsResult] = await Promise.all([
    supabaseClient.from("products").select(`${PRODUCT_FIELDS},sort_order`).order("sort_order", { ascending: true }).order("id", { ascending: true }),
    supabaseClient.from("product_costs").select("product_id,unit_cost"),
  ]);
  let productsResult = orderedProductsResult;
  productOrderingEnabled = !orderedProductsResult.error;
  if (isMissingProductSortColumn(orderedProductsResult.error)) {
    productOrderingEnabled = false;
    productsResult = await supabaseClient.from("products").select(PRODUCT_FIELDS).order("id", { ascending: true });
  }
  if (productsResult.error) throw productsResult.error;
  if (costsResult.error) throw costsResult.error;
  const costsByProduct = new Map((costsResult.data || []).map((row) => [
    Number(row.product_id), row.unit_cost == null ? null : Number(row.unit_cost),
  ]));
  products = (productsResult.data || []).map((row) => ({
    ...normalizeProduct(row),
    purchaseCost: costsByProduct.get(Number(row.id)) ?? null,
  }));
  renderTable();
}

function resetForm() {
  productForm.reset();
  if (productDialog.open) productDialog.close();
  document.getElementById("productId").value = "";
  currentImageInput.value = "";
  productImageInput.value = "";
  setImagePreview("");
  formTitle.textContent = "إضافة منتج";
  document.getElementById("saveProduct").textContent = "حفظ المنتج";
  document.getElementById("rating").value = "4.8";
  updateProductProfitPreview();
}

function updateProductProfitPreview() {
  const sellingPrice = Number(document.getElementById("price").value);
  const purchaseCostInput = document.getElementById("purchaseCost").value.trim();
  const purchaseCost = Number(purchaseCostInput);
  const preview = document.getElementById("productUnitProfitPreview");
  if (!purchaseCostInput || !Number.isFinite(sellingPrice) || !Number.isFinite(purchaseCost)) {
    preview.textContent = "أدخل سعر البيع وتكلفة الشراء";
    preview.classList.remove("is-negative");
    return;
  }
  const profit = sellingPrice - purchaseCost;
  preview.textContent = formatMoney(profit);
  preview.classList.toggle("is-negative", profit < 0);
}

function getOrderReturnProducts(order) {
  const productsById = new Map();
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1) continue;
    const existing = productsById.get(productId);
    const unitPrice = Number(item.unit_price ?? item.price);
    if (existing) {
      existing.quantity += quantity;
      if (existing.unitPrice !== unitPrice) existing.hasMixedPrices = true;
    } else {
      productsById.set(productId, {
        productId,
        name: String(item.name || "منتج"),
        quantity,
        unitPrice,
        hasMixedPrices: false,
      });
    }
  }
  return [...productsById.values()];
}

function getOrderReturnState(order) {
  const products = getOrderReturnProducts(order);
  const total = products.reduce((sum, item) => sum + item.quantity, 0);
  const returned = products.reduce((sum, item) => sum + Number(order.returnedQuantities?.[item.productId] || 0), 0);
  return { products, total, returned, remaining: Math.max(0, total - returned) };
}

function renderOrderReturnBadge(order) {
  const returnState = getOrderReturnState(order);
  if (returnState.returned === 0) return "";
  const label = returnState.remaining > 0 ? "مرتجع جزئي" : "مرتجع كامل";
  const refund = Number(order.returnRefundTotal || 0);
  const title = refund > 0 ? `${label} · قيمة المنتجات المستردة ${formatMoney(refund)}` : label;
  return `<span class="order-return-badge" title="${escapeHtml(title)}">${label}</span>`;
}

function renderOrders() {
  const rows = orders.map((order) => {
    const customerName = `${order.first_name} ${order.last_name}`.trim();
    const returnState = getOrderReturnState(order);
    const createdAt = new Date(order.created_at);
    const formattedDate = Number.isNaN(createdAt.getTime())
      ? "—"
      : createdAt.toLocaleString("ar-EG");

    return `
      <tr>
        <td dir="ltr">${escapeHtml(String(order.id).slice(0, 8))}</td>
        <td>${escapeHtml(customerName)}<br><small>${escapeHtml(order.address)}, ${escapeHtml(order.building)}, ${escapeHtml(order.floor)}, ${escapeHtml(order.apartment)}</small></td>
        <td dir="ltr">${escapeHtml(order.phone)}</td>
        <td>${escapeHtml(order.city)}، ${escapeHtml(order.governorate)}</td>
        <td>${escapeHtml(order.notes || "—")}</td>
        <td>${formatMoney(order.total)}</td>
        <td>
          <select class="order-status order-status-${escapeHtml(order.status)}" data-order-id="${escapeHtml(order.id)}" data-current-status="${escapeHtml(order.status)}" aria-label="حالة الطلب">
            ${renderOrderStatusOptions(order)}
          </select>
          ${renderOrderReturnBadge(order)}
        </td>
        <td>${escapeHtml(formattedDate)}</td>
        <td><div class="order-row-actions">
          <button class="btn btn-secondary order-details-button" type="button" data-order-details="${escapeHtml(order.id)}">تفاصيل الطلب</button>
          ${order.status === "delivered" ? `<button class="btn btn-secondary order-return-button" type="button" data-order-return="${escapeHtml(order.id)}" ${returnState.remaining === 0 ? "disabled" : ""}>${returnState.remaining === 0 ? "اكتمل المرتجع" : "تسجيل مرتجع"}</button>` : ""}
        </div></td>
      </tr>
    `;
  }).join("");

  document.getElementById("ordersTableBody").innerHTML = rows;
  document.getElementById("ordersEmpty").classList.toggle("hidden", orders.length > 0);
  renderQuickOrders();
}

function renderQuickOrders() {
  const recentOrders = orders.slice(0, 5);
  const rows = recentOrders.map((order) => {
    const customerName = `${order.first_name} ${order.last_name}`.trim();
    const createdAt = new Date(order.created_at);
    const formattedDate = Number.isNaN(createdAt.getTime())
      ? "—"
      : createdAt.toLocaleString("ar-EG");

    return `
      <tr>
        <td dir="ltr">${escapeHtml(String(order.id).slice(0, 8))}</td>
        <td>${escapeHtml(customerName)}</td>
        <td dir="ltr">${escapeHtml(order.phone)}</td>
        <td>${formatMoney(order.total)}</td>
        <td>
          <select class="order-status order-status-${escapeHtml(order.status)}" data-order-id="${escapeHtml(order.id)}" data-current-status="${escapeHtml(order.status)}" aria-label="حالة الطلب">
            ${renderOrderStatusOptions(order)}
          </select>
          ${renderOrderReturnBadge(order)}
        </td>
        <td>${escapeHtml(formattedDate)}</td>
        <td><button class="btn btn-secondary order-details-button" type="button" data-order-details="${escapeHtml(order.id)}">تفاصيل الطلب</button></td>
      </tr>
    `;
  }).join("");

  document.getElementById("quickOrdersTableBody").innerHTML = rows;
  document.getElementById("quickOrdersEmpty").classList.toggle("hidden", recentOrders.length > 0);
}

function renderOrdersPagination() {
  const pagination = document.getElementById("ordersPagination");
  const pageStatus = document.getElementById("ordersPageStatus");
  const previousButton = document.getElementById("previousOrdersPage");
  const nextButton = document.getElementById("nextOrdersPage");
  if (!pagination || !pageStatus || !previousButton || !nextButton) return;

  const firstOrder = ordersTotalCount ? ordersPage * ORDERS_PAGE_SIZE + 1 : 0;
  const lastOrder = Math.min((ordersPage + 1) * ORDERS_PAGE_SIZE, ordersTotalCount);
  pageStatus.textContent = `عرض ${firstOrder}–${lastOrder} من ${ordersTotalCount.toLocaleString("ar-EG")}`;
  previousButton.disabled = ordersPage === 0;
  nextButton.disabled = (ordersPage + 1) * ORDERS_PAGE_SIZE >= ordersTotalCount;
  pagination.classList.toggle("hidden", ordersTotalCount <= ORDERS_PAGE_SIZE);
}

async function loadOrders({ announceNewOrders = false, page = ordersPage } = {}) {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  const refreshButtons = [
    document.getElementById("refreshOrders"),
    document.getElementById("refreshQuickOrders"),
  ];
  for (const button of refreshButtons) {
    button.disabled = true;
    button.classList.add("is-loading");
  }
  ordersPage = Math.max(0, Math.floor(page));
  try {
    const existingOrderIds = new Set(orders.map((order) => String(order.id)));
    const { data, error, count } = await supabaseClient
      .from("orders")
      .select("id,created_at,first_name,last_name,phone,governorate,city,address,building,floor,apartment,notes,items,subtotal,shipping,total,status", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(ordersPage * ORDERS_PAGE_SIZE, (ordersPage + 1) * ORDERS_PAGE_SIZE - 1);
    if (error) throw error;
    const loadedOrders = data || [];
    const orderIds = loadedOrders.map((order) => String(order.id));
    const returnedQuantitiesByOrder = new Map();
    const returnLinesByOrder = new Map();
    const refundAmountsByOrder = new Map();
    if (orderIds.length) {
      const [returnItemsResult, returnHeadersResult] = await Promise.all([
        supabaseClient.from("order_return_items")
          .select("order_id,product_id,product_name_snapshot,quantity,disposition")
          .in("order_id", orderIds),
        supabaseClient.from("order_returns")
          .select("order_id,refund_amount")
          .in("order_id", orderIds),
      ]);
      if (returnItemsResult.error) throw returnItemsResult.error;
      if (returnHeadersResult.error) throw returnHeadersResult.error;
      for (const returnLine of returnItemsResult.data || []) {
        const orderKey = String(returnLine.order_id);
        const productKey = Number(returnLine.product_id);
        const returnedQuantities = returnedQuantitiesByOrder.get(orderKey) || {};
        returnedQuantities[productKey] = (returnedQuantities[productKey] || 0) + Number(returnLine.quantity || 0);
        returnedQuantitiesByOrder.set(orderKey, returnedQuantities);
        const lines = returnLinesByOrder.get(orderKey) || [];
        lines.push(returnLine);
        returnLinesByOrder.set(orderKey, lines);
      }
      for (const returnHeader of returnHeadersResult.data || []) {
        const orderKey = String(returnHeader.order_id);
        refundAmountsByOrder.set(orderKey,
          (refundAmountsByOrder.get(orderKey) || 0) + Number(returnHeader.refund_amount || 0));
      }
    }
    orders = loadedOrders.map((order) => ({
      ...order,
      returnedQuantities: returnedQuantitiesByOrder.get(String(order.id)) || {},
      returnLines: returnLinesByOrder.get(String(order.id)) || [],
      returnRefundTotal: refundAmountsByOrder.get(String(order.id)) || 0,
    }));
    ordersTotalCount = Number.isFinite(count) ? count : ordersTotalCount;
    renderOrders();
    renderOrdersPagination();
    if (announceNewOrders) {
      const newOrdersCount = orders.filter((order) => !existingOrderIds.has(String(order.id))).length;
      showToast(newOrdersCount === 0
        ? "لا توجد طلبات جديدة"
        : `تم العثور على ${newOrdersCount.toLocaleString("ar-EG")} من الطلبات الجديدة`);
    }
  } catch (error) {
    console.error("تعذر تحميل الطلبات من Supabase.", error);
    showToast("تعذر تحميل الطلبات. تأكد من تطبيق إعداد جدول الطلبات في Supabase.");
  } finally {
    for (const button of refreshButtons) {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }
}

function renderAccountEntries(entries) {
  const body = document.getElementById("accountEntriesBody");
  body.innerHTML = entries.map((entry) => {
    const isIncome = entry.entry_type === "income";
    const isSalesReturn = entry.entry_type === "sales_return";
    const typeLabel = isSalesReturn ? "مردود مبيعات" : isIncome ? "مقبوض" : "مصروف";
    const typeClass = isSalesReturn ? "entry-sales-return" : isIncome ? "entry-income" : "entry-expense";
    const formattedDate = formatAdminDate(`${entry.entry_date}T00:00:00`);
    return `
      <tr>
        <td>${escapeHtml(formattedDate)}</td>
        <td><span class="${typeClass}">${typeLabel}</span></td>
        <td>${escapeHtml(ACCOUNT_CATEGORY_LABELS[entry.category] || entry.category)}</td>
        <td>${escapeHtml(PAYMENT_METHOD_LABELS[entry.payment_method] || entry.payment_method)}</td>
        <td>${escapeHtml([
          entry.order_id ? `طلب ${String(entry.order_id).slice(0, 8)}` : "",
          entry.reference || "",
        ].filter(Boolean).join(" · ") || "—")}</td>
        <td><strong>${isSalesReturn ? `−${formatMoney(entry.amount)}` : formatMoney(entry.amount)}</strong></td>
        <td>${escapeHtml(entry.notes || "—")}</td>
      </tr>
    `;
  }).join("");
  document.getElementById("accountEntriesEmpty").classList.toggle("hidden", entries.length > 0);
}

function renderProductProfitSummary(rows) {
  const body = document.getElementById("productProfitTableBody");
  const hasMissingCost = rows.some((row) => Number(row.units_sold || 0) > 0 && row.missing_cost);
  const hasEstimatedCost = rows.some((row) => row.estimated_cost);
  const knownProfit = rows.reduce((sum, row) => sum + (row.gross_profit == null ? 0 : Number(row.gross_profit)), 0);

  body.innerHTML = rows.map((row) => {
    const purchaseCost = row.purchase_cost == null ? null : Number(row.purchase_cost);
    const sellingPrice = row.selling_price == null ? null : Number(row.selling_price);
    const unitProfit = row.unit_profit == null ? null : Number(row.unit_profit);
    const grossProfit = row.gross_profit == null ? null : Number(row.gross_profit);
    const missingCost = Number(row.units_sold || 0) > 0 && Boolean(row.missing_cost);
    const profitMarkup = missingCost
      ? '<span class="product-profit-missing">سجّل تكلفة الشراء</span>'
      : `${formatMoney(grossProfit ?? 0)}${row.estimated_cost ? '<small class="profit-estimate-label">تقديري</small>' : ""}`;
    return `
      <tr>
        <td><strong>${escapeHtml(row.product_name || "منتج")}</strong></td>
        <td>${sellingPrice == null ? "—" : formatMoney(sellingPrice)}</td>
        <td>${purchaseCost == null ? '<span class="product-profit-missing">غير مسجل</span>' : formatMoney(purchaseCost)}</td>
        <td>${unitProfit == null ? "—" : `<span class="${unitProfit < 0 ? "product-profit-negative" : "product-profit-positive"}">${formatMoney(unitProfit)}</span>`}</td>
        <td>${formatCount(row.units_sold)}</td>
        <td>${formatCount(row.units_returned)}</td>
        <td>${row.net_sales == null ? "—" : formatMoney(row.net_sales)}</td>
        <td>${row.cost_of_goods == null ? "—" : formatMoney(row.cost_of_goods)}</td>
        <td><strong class="${grossProfit != null && grossProfit < 0 ? "product-profit-negative" : "product-profit-positive"}">${profitMarkup}</strong></td>
      </tr>
    `;
  }).join("");

  document.getElementById("accountsProductProfitTotal").textContent = hasMissingCost
    ? "إجمالي الربح المحقق: غير مكتمل"
    : `إجمالي الربح المحقق: ${formatMoney(knownProfit)}`;
  document.getElementById("productProfitHint").textContent = hasMissingCost
    ? "سجّل تكلفة الشراء للمنتجات التي بيعت حتى يظهر ربحها وإجمالي الربح بالكامل. الطلبات القديمة تُقدّر بالتكلفة الحالية عند توفرها."
    : hasEstimatedCost
      ? "الربح = صافي قيمة المنتجات بعد المرتجعات − تكلفة الوحدات المباعة. الطلبات السابقة لتسجيل التكلفة حُسبت تقديرياً بالتكلفة الحالية."
      : "الربح = صافي قيمة المنتجات بعد المرتجعات − تكلفة الوحدات المباعة. تُعاد تكلفة المنتج الصالح إلى المخزون؛ تكاليف الطلبات الجديدة محفوظة وقت الشراء.";
  document.getElementById("productProfitEmpty").classList.toggle("hidden", rows.length > 0);
}

async function loadAccounts() {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  try {
    const [summaryResult, entriesResult, profitResult] = await Promise.all([
      supabaseClient.rpc("get_account_month_summary", { p_month_start: getCurrentMonthStart() }),
      supabaseClient.from("account_entries")
        .select("id,entry_type,category,amount,payment_method,entry_date,order_id,reference,notes,created_at")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseClient.rpc("get_product_profit_summary"),
    ]);
    if (summaryResult.error) throw summaryResult.error;
    if (entriesResult.error) throw entriesResult.error;
    if (profitResult.error) throw profitResult.error;

    const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    const income = Number(summary?.income_total || 0);
    const salesReturns = Number(summary?.sales_returns_total || 0);
    const expenses = Number(summary?.expense_total || 0);
    const net = income - salesReturns - expenses;
    const netElement = document.getElementById("accountsNetMonth");
    document.getElementById("accountsIncomeMonth").textContent = formatMoney(income);
    document.getElementById("accountsReturnsMonth").textContent = formatMoney(salesReturns);
    document.getElementById("accountsExpensesMonth").textContent = formatMoney(expenses);
    netElement.textContent = formatMoney(net);
    netElement.classList.toggle("account-net-negative", net < 0);
    document.getElementById("accountsEntriesMonth").textContent = formatCount(summary?.entry_count || 0);
    renderAccountEntries(entriesResult.data || []);
    renderProductProfitSummary(profitResult.data || []);
  } catch (error) {
    console.error("تعذر تحميل سجل الحسابات.", error);
    showToast("تعذر تحميل الحسابات. تأكد من تطبيق إعدادات التكلفة والأرباح في Supabase.");
  }
}

const INQUIRY_STATUS_LABELS = {
  new: "جديد",
  reviewing: "قيد المراجعة",
  answered: "تم الرد",
  closed: "مغلق",
};

function renderInquiries() {
  const body = document.getElementById("inquiriesTableBody");
  body.innerHTML = productInquiries.map((inquiry) => `
    <tr>
      <td class="inquiry-product-name">${escapeHtml(inquiry.product_name)}</td>
      <td>${escapeHtml(inquiry.description || "—")}</td>
      <td>${escapeHtml(formatAdminDate(inquiry.created_at, true))}</td>
      <td><span class="inquiry-status inquiry-status-${escapeHtml(inquiry.status)}">${escapeHtml(INQUIRY_STATUS_LABELS[inquiry.status] || "غير معروف")}</span></td>
      <td><button class="btn btn-secondary inquiry-open-button" type="button" data-open-inquiry="${escapeHtml(inquiry.id)}">فتح</button></td>
    </tr>
  `).join("");
  document.getElementById("inquiriesEmpty").classList.toggle("hidden", productInquiries.length > 0);
}

function renderInquiryPagination() {
  const pagination = document.getElementById("inquiriesPagination");
  const start = inquiriesTotalCount ? inquiriesPage * INQUIRY_PAGE_SIZE + 1 : 0;
  const end = Math.min((inquiriesPage + 1) * INQUIRY_PAGE_SIZE, inquiriesTotalCount);
  document.getElementById("inquiriesPageStatus").textContent = `عرض ${formatCount(start)}–${formatCount(end)} من ${formatCount(inquiriesTotalCount)}`;
  document.getElementById("previousInquiriesPage").disabled = inquiriesPage === 0;
  document.getElementById("nextInquiriesPage").disabled = (inquiriesPage + 1) * INQUIRY_PAGE_SIZE >= inquiriesTotalCount;
  pagination.classList.toggle("hidden", inquiriesTotalCount <= INQUIRY_PAGE_SIZE);
}

async function loadInquiries({ page = inquiriesPage } = {}) {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  const refreshButton = document.getElementById("refreshInquiries");
  refreshButton.disabled = true;
  try {
    const monthStart = `${getCurrentMonthStart()}T00:00:00`;
    const selectedStatus = document.getElementById("inquiryStatusFilter").value;
    inquiriesPage = Math.max(0, Math.floor(page));
    let listQuery = supabaseClient.from("product_inquiries")
      .select("id,product_name,description,status,created_at,updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(inquiriesPage * INQUIRY_PAGE_SIZE, (inquiriesPage + 1) * INQUIRY_PAGE_SIZE - 1);
    if (selectedStatus !== "all") listQuery = listQuery.eq("status", selectedStatus);

    const [totalResult, newResult, monthResult, listResult] = await Promise.all([
      supabaseClient.from("product_inquiries").select("id", { count: "exact", head: true }),
      supabaseClient.from("product_inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabaseClient.from("product_inquiries").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
      listQuery,
    ]);
    for (const result of [totalResult, newResult, monthResult, listResult]) {
      if (result.error) throw result.error;
    }

    productInquiries = listResult.data || [];
    inquiriesTotalCount = Number.isFinite(listResult.count) ? listResult.count : 0;
    document.getElementById("inquiriesTotal").textContent = formatCount(totalResult.count);
    document.getElementById("inquiriesNew").textContent = formatCount(newResult.count);
    document.getElementById("inquiriesThisMonth").textContent = formatCount(monthResult.count);
    const badge = document.getElementById("adminNewInquiriesBadge");
    badge.textContent = formatCount(newResult.count);
    badge.classList.toggle("hidden", !newResult.count);
    renderInquiries();
    renderInquiryPagination();
  } catch (error) {
    console.error("تعذر تحميل استفسارات المنتجات.", error);
    showToast("تعذر تحميل الاستفسارات. تأكد من تطبيق إعدادات الاستفسارات في Supabase.");
  } finally {
    refreshButton.disabled = false;
  }
}

function openInquiryDetails(inquiry) {
  selectedInquiry = inquiry;
  document.getElementById("inquiryDetailsProduct").value = inquiry.product_name || "";
  document.getElementById("inquiryDetailsDescription").value = inquiry.description || "لا توجد تفاصيل إضافية.";
  document.getElementById("inquiryDetailsDate").textContent = `تاريخ الاستفسار: ${formatAdminDate(inquiry.created_at, true)}`;
  document.getElementById("inquiryDetailsStatus").value = inquiry.status;
  inquiryDetailsDialog.showModal();
}

function renderAnalyticsTrend(rows) {
  const container = document.getElementById("analyticsTrend");
  const values = (rows || []).map((row) => Number(row.net_sales || 0));
  const maxValue = Math.max(...values, 0);
  container.innerHTML = (rows || []).map((row) => {
    const sales = Number(row.net_sales || 0);
    const height = maxValue > 0 ? Math.max(4, (sales / maxValue) * 100) : 4;
    const details = `${row.label}: ${formatCount(row.delivered_orders)} طلب مسلّم، ${formatMoney(sales)}`;
    return `
      <div class="analytics-trend-item" role="group" title="${escapeHtml(details)}">
        <div class="analytics-trend-bar-wrap"><div class="analytics-trend-bar" style="height:${height}%"></div></div>
        <strong>${escapeHtml(formatMoney(sales))}</strong>
        <small>${escapeHtml(formatCount(row.delivered_orders))} طلب</small>
        <small>${escapeHtml(row.label)}</small>
      </div>
    `;
  }).join("");
  document.getElementById("analyticsTrendEmpty").classList.toggle("hidden", Boolean(rows?.length));
}

function renderBusinessAnalytics(data) {
  const summary = data.summary || {};
  const accounts = data.accounts || {};
  const inventory = data.inventory || {};
  const inquiries = data.inquiries || {};
  const profitValue = summary.gross_profit == null ? "غير مكتمل" : formatMoney(summary.gross_profit);

  document.getElementById("analyticsNetSales").textContent = formatMoney(summary.net_sales);
  document.getElementById("analyticsGrossProfit").textContent = profitValue;
  document.getElementById("analyticsProfitNote").textContent = summary.profit_complete
    ? "صافي المبيعات بعد تكلفة المنتجات"
    : "سجّل تكلفة المنتجات المباعة لاكتمال الحساب";
  document.getElementById("analyticsAccountNet").textContent = formatMoney(accounts.net);
  document.getElementById("analyticsDeliveredOrders").textContent = formatCount(summary.delivered_orders);
  document.getElementById("analyticsOrdersCaption").textContent = `من ${formatCount(summary.orders_count)} طلب`;
  document.getElementById("analyticsAverageOrder").textContent = formatMoney(summary.average_order_value);
  document.getElementById("analyticsCustomers").textContent = formatCount(summary.customers_count);
  document.getElementById("analyticsRepeatCustomers").textContent = `${formatCount(summary.repeat_customers)} عميل متكرر`;
  document.getElementById("analyticsOpenOrders").textContent = `${formatCount(summary.open_orders)} مفتوح`;
  const returnRate = Number(summary.delivered_orders)
    ? ((Number(summary.returned_orders || 0) / Number(summary.delivered_orders)) * 100).toLocaleString("ar-EG", { maximumFractionDigits: 1 })
    : "٠";
  document.getElementById("analyticsCancelledOrders").textContent = `${formatCount(summary.cancelled_orders)} ملغي · معدل المرتجعات ${returnRate}٪`;
  document.getElementById("analyticsInquiryCount").textContent = formatCount(inquiries.count);
  document.getElementById("analyticsNewInquiries").textContent = `${formatCount(inquiries.new_count)} بانتظار المراجعة`;
  document.getElementById("analyticsAvailableUnits").textContent = formatCount(inventory.available_units);
  document.getElementById("analyticsReservedUnits").textContent = formatCount(inventory.reserved_units);
  document.getElementById("analyticsLowStock").textContent = formatCount(inventory.low_stock_products);
  document.getElementById("analyticsOutOfStock").textContent = formatCount(inventory.out_of_stock_products);

  renderAnalyticsTrend(data.trend || []);

  const productsBody = document.getElementById("analyticsProductsBody");
  productsBody.innerHTML = (data.products || []).map((product) => `
    <tr>
      <td><strong>${escapeHtml(product.product_name || "منتج")}</strong></td>
      <td>${formatCount(product.units_sold)}</td>
      <td>${formatCount(product.units_returned)}</td>
      <td>${product.available_now == null ? "غير مجرود" : formatCount(product.available_now)}</td>
      <td>${formatMoney(product.net_sales)}</td>
      <td>${product.gross_profit == null ? '<span class="product-profit-missing">غير مكتمل</span>' : `<span class="${Number(product.gross_profit) < 0 ? "analytics-negative" : "analytics-positive"}">${formatMoney(product.gross_profit)}</span>`}</td>
    </tr>
  `).join("");
  document.getElementById("analyticsProductsEmpty").classList.toggle("hidden", Boolean(data.products?.length));

  const categoriesBody = document.getElementById("analyticsCategoriesBody");
  categoriesBody.innerHTML = (data.categories || []).map((category) => `
    <tr>
      <td><strong>${escapeHtml(categoryNames[category.category] || category.category || "أخرى")}</strong></td>
      <td>${formatCount(category.units_sold)}</td>
      <td>${formatMoney(category.net_sales)}</td>
      <td>${category.gross_profit == null ? '<span class="product-profit-missing">غير مكتمل</span>' : `<span class="${Number(category.gross_profit) < 0 ? "analytics-negative" : "analytics-positive"}">${formatMoney(category.gross_profit)}</span>`}</td>
    </tr>
  `).join("");
  document.getElementById("analyticsCategoriesEmpty").classList.toggle("hidden", Boolean(data.categories?.length));

  const customersBody = document.getElementById("analyticsCustomersBody");
  customersBody.innerHTML = (data.customers || []).map((customer) => `
    <tr>
      <td><strong>${escapeHtml(customer.customer_name || "عميل")}</strong></td>
      <td><span class="analytics-phone">${escapeHtml(customer.phone || "—")}</span></td>
      <td>${formatCount(customer.orders_count)}</td>
      <td>${formatCount(customer.delivered_orders)}</td>
      <td>${formatMoney(customer.net_sales)}</td>
      <td>${escapeHtml(formatAdminDate(customer.last_order_at))}</td>
    </tr>
  `).join("");
  document.getElementById("analyticsCustomersEmpty").classList.toggle("hidden", Boolean(data.customers?.length));

  const inquiriesBody = document.getElementById("analyticsInquiriesBody");
  inquiriesBody.innerHTML = (inquiries.top_products || []).map((inquiry) => `
    <tr>
      <td><strong>${escapeHtml(inquiry.product_name)}</strong></td>
      <td>${formatCount(inquiry.request_count)}</td>
      <td>${formatCount(inquiry.new_count)}</td>
      <td>${escapeHtml(formatAdminDate(inquiry.last_requested_at, true))}</td>
    </tr>
  `).join("");
  document.getElementById("analyticsInquiriesEmpty").classList.toggle("hidden", Boolean(inquiries.top_products?.length));
}

async function loadBusinessAnalytics() {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }
  const refreshButton = document.getElementById("refreshAnalytics");
  refreshButton.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc("get_business_analytics", {
      p_period: document.getElementById("analyticsRange").value,
    });
    if (error) throw error;
    renderBusinessAnalytics(data || {});
  } catch (error) {
    console.error("تعذر تحميل تحليلات الأعمال.", error);
    showToast("تعذر تحميل التحليلات. تأكد من تطبيق إعدادات التحليلات في Supabase.");
  } finally {
    refreshButton.disabled = false;
  }
}

function updateAccountCategoryOptions() {
  const type = document.getElementById("accountEntryType").value;
  const categories = ACCOUNT_CATEGORY_OPTIONS[type] || ACCOUNT_CATEGORY_OPTIONS.income;
  document.getElementById("accountEntryCategory").innerHTML = categories.map(([value, label]) =>
    `<option value="${value}">${label}</option>`
  ).join("");
}

async function openAccountEntryDialog() {
  const form = document.getElementById("accountEntryForm");
  form.reset();
  document.getElementById("accountEntryDate").value = getTodayDateInputValue();
  updateAccountCategoryOptions();
  const orderSelect = document.getElementById("accountEntryOrder");
  orderSelect.innerHTML = '<option value="">بدون ربط بطلب</option>';
  try {
    const { data, error } = await supabaseClient.from("orders")
      .select("id,first_name,last_name,total,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    orderSelect.innerHTML += (data || []).map((order) => {
      const name = `${order.first_name || ""} ${order.last_name || ""}`.trim();
      const label = `طلب ${String(order.id).slice(0, 8)} · ${name} · ${formatMoney(order.total)}`;
      return `<option value="${escapeHtml(order.id)}">${escapeHtml(label)}</option>`;
    }).join("");
  } catch (error) {
    console.error("تعذر تحميل الطلبات لربط الحركة المالية.", error);
    showToast("تعذر تحميل قائمة الطلبات؛ يمكنك تسجيل الحركة بدون ربط.");
  }
  accountEntryDialog.showModal();
}

function fillForm(product) {
  document.getElementById("productId").value = String(product.id);
  document.getElementById("name").value = product.name;
  document.getElementById("category").value = product.category;
  document.getElementById("price").value = String(product.price);
  document.getElementById("purchaseCost").value = product.purchaseCost == null ? "" : String(product.purchaseCost);
  document.getElementById("oldPrice").value = product.old ? String(product.old) : "";
  document.getElementById("tag").value = product.tag;
  document.getElementById("rating").value = String(product.rating);
  document.getElementById("meta").value = product.meta;
  document.getElementById("specs").value = JSON.stringify(product.specs, null, 2);
  currentImageInput.value = product.image;
  setImagePreview(product.image);
  formTitle.textContent = "تعديل المنتج";
  document.getElementById("saveProduct").textContent = "تحديث المنتج";
  updateProductProfitPreview();
}

async function optimizeImageFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم الصورة الأصلية أكبر من 5 ميجابايت");

  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  const compressedImage = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("تعذر ضغط الصورة"));
    }, "image/webp", 0.78);
  });
  if (compressedImage.size > 500 * 1024) throw new Error("تعذر ضغط الصورة إلى أقل من 500 كيلوبايت");
  return readImageFile(compressedImage);
}

productImageInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    productImageInput.value = "";
    showToast("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 5 ميجابايت");
    return;
  }

  try {
    currentImageInput.value = await optimizeImageFile(file);
    setImagePreview(currentImageInput.value);
  } catch (error) {
    console.error("تعذرت معالجة صورة المنتج.", error);
    showToast(error.message || "تعذرت معالجة الصورة، حاول مرة أخرى");
  }
});

productTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const product = products.find((item) => item.id === Number(button.dataset.id));
  if (!product) return;

  if (button.dataset.action === "move-up" || button.dataset.action === "move-down") {
    const productIndex = products.findIndex((item) => item.id === product.id);
    const targetIndex = productIndex + (button.dataset.action === "move-up" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= products.length) return;
    const nextProducts = [...products];
    nextProducts.splice(productIndex, 1);
    nextProducts.splice(targetIndex, 0, product);
    await saveProductOrder(nextProducts.map((item) => item.id));
    return;
  }

  if (button.dataset.action === "edit") {
    fillForm(product);
    productDialog.showModal();
    return;
  }

  if (button.dataset.action !== "delete" || !window.confirm(`حذف المنتج "${product.name}"؟`)) return;

  button.disabled = true;
  const { error } = await supabaseClient.from("products").delete().eq("id", product.id);
  if (error) {
    console.error("تعذر حذف المنتج من Supabase.", error);
    showToast("تعذر حذف المنتج. لم يتم تغيير البيانات.");
    button.disabled = false;
    return;
  }

  products = products.filter((item) => item.id !== product.id);
  renderTable();
  resetForm();
  showToast("تم حذف المنتج");
});

productTableBody.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-sort-handle]");
  if (!handle || productReorderBusy) {
    event.preventDefault();
    return;
  }
  draggedProductId = Number(handle.dataset.id);
  handle.closest("tr")?.classList.add("product-row-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedProductId));
});

productTableBody.addEventListener("dragover", (event) => {
  if (draggedProductId === null) return;
  const targetRow = event.target.closest("tr[data-product-row]");
  const draggedRow = productTableBody.querySelector(`tr[data-product-row="${draggedProductId}"]`);
  if (!targetRow || !draggedRow || targetRow === draggedRow) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  productTableBody.querySelectorAll(".product-row-drop-target").forEach((row) => row.classList.remove("product-row-drop-target"));
  targetRow.classList.add("product-row-drop-target");
  const placeAfter = event.clientY > targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2;
  productTableBody.insertBefore(draggedRow, placeAfter ? targetRow.nextElementSibling : targetRow);
});

productTableBody.addEventListener("drop", (event) => {
  if (draggedProductId === null) return;
  event.preventDefault();
  const productIds = [...productTableBody.querySelectorAll("tr[data-product-row]")]
    .map((row) => Number(row.dataset.productRow));
  draggedProductId = null;
  productTableBody.querySelectorAll(".product-row-dragging, .product-row-drop-target")
    .forEach((row) => row.classList.remove("product-row-dragging", "product-row-drop-target"));
  void saveProductOrder(productIds);
});

productTableBody.addEventListener("dragend", () => {
  draggedProductId = null;
  productTableBody.querySelectorAll(".product-row-dragging, .product-row-drop-target")
    .forEach((row) => row.classList.remove("product-row-dragging", "product-row-drop-target"));
  if (!productReorderBusy) renderTable();
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = document.getElementById("productId").value;
  const name = document.getElementById("name").value.trim();
  const meta = document.getElementById("meta").value.trim();
  const price = Number(document.getElementById("price").value);
  const purchaseCostInput = document.getElementById("purchaseCost").value.trim();
  const purchaseCost = Number(purchaseCostInput);
  const oldPriceValue = document.getElementById("oldPrice").value;
  const oldPrice = oldPriceValue ? Number(oldPriceValue) : null;
  const specsText = document.getElementById("specs").value.trim();
  let specs = {};

  if (!name || !meta || !Number.isFinite(price) || price <= 0 ||
      !purchaseCostInput || !Number.isFinite(purchaseCost) || purchaseCost < 0 ||
      (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < 0))) {
    showToast("تحقق من اسم المنتج ووصفه وسعره وتكلفة شرائه");
    return;
  }

  if (specsText) {
    try {
      specs = JSON.parse(specsText);
      if (!specs || typeof specs !== "object" || Array.isArray(specs)) throw new Error("المواصفات يجب أن تكون كائن JSON");
    } catch (error) {
      showToast("المواصفات يجب أن تكون بصيغة JSON صحيحة");
      return;
    }
  }

  const category = document.getElementById("category").value;
  const payload = {
    name,
    category,
    price,
    old_price: oldPrice,
    tag: document.getElementById("tag").value.trim() || null,
    meta,
    rating: Number(document.getElementById("rating").value || 4.8),
    specs,
    image: currentImageInput.value || null,
    type: category === "boards" ? "goldboard" :
      category === "cupcakes" ? "cup" :
      category === "packaging" ? "ribbon" : "box",
  };
  const saveButton = document.getElementById("saveProduct");
  saveButton.disabled = true;
  let uploadedImagePath = "";
  let catalogSaved = false;

  try {
    if (currentImageInput.value.startsWith("data:image/")) {
      const uploadedImage = await uploadProductImage(currentImageInput.value);
      uploadedImagePath = uploadedImage.path;
      payload.image = uploadedImage.url;
    }

    const query = productId
      ? supabaseClient.from("products").update(payload).eq("id", Number(productId))
      : supabaseClient.from("products").insert(payload);
    const { data, error } = await query.select(PRODUCT_FIELDS).single();
    if (error) throw error;

    const savedProduct = normalizeProduct(data);
    catalogSaved = true;
    const { error: costError } = await supabaseClient.from("product_costs").upsert({
      product_id: savedProduct.id,
      unit_cost: purchaseCost,
    }, { onConflict: "product_id" });
    if (costError) {
      try { await loadProducts(); } catch (reloadError) { console.error("تعذر تحديث قائمة المنتجات بعد خطأ التكلفة.", reloadError); }
      throw new Error("تم حفظ بيانات المنتج، لكن تعذر حفظ تكلفة الشراء. أعد تعديل المنتج وحفظ التكلفة مرة أخرى.");
    }
    savedProduct.purchaseCost = purchaseCost;
    products = productId
      ? products.map((product) => product.id === savedProduct.id ? savedProduct : product)
      : [...products, savedProduct];
    renderTable();
    resetForm();
    showToast(productId ? "تم تحديث المنتج" : "تمت إضافة المنتج");
  } catch (error) {
    console.error("تعذر حفظ المنتج في Supabase.", error);
    if (uploadedImagePath && !catalogSaved) {
      const { error: cleanupError } = await supabaseClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
      if (cleanupError) console.error("تعذر حذف صورة المنتج التي لم يتم حفظها.", cleanupError);
    }
    showToast(error instanceof Error ? error.message : "تعذر حفظ المنتج. لم يتم تغيير البيانات.");
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById("addProductButton").addEventListener("click", () => {
  resetForm();
  productDialog.showModal();
});

document.getElementById("price").addEventListener("input", updateProductProfitPreview);
document.getElementById("purchaseCost").addEventListener("input", updateProductProfitPreview);

document.getElementById("closeProductDialog").addEventListener("click", resetForm);
document.getElementById("cancelProductDialog").addEventListener("click", resetForm);

productDialog.addEventListener("click", (event) => {
  if (event.target === productDialog) resetForm();
});

productDialog.addEventListener("cancel", () => resetForm());

document.getElementById("refreshOrders").addEventListener("click", () => loadOrders({ announceNewOrders: true }));
document.getElementById("refreshQuickOrders").addEventListener("click", () => loadOrders({ announceNewOrders: true }));

document.getElementById("refreshInventory").addEventListener("click", loadInventory);
document.getElementById("addInventoryMovement").addEventListener("click", () => openInventoryDialog());
document.getElementById("inventoryTableBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-inventory-action='edit']");
  if (button) openInventoryDialog(Number(button.dataset.productId));
});
document.getElementById("inventoryProduct").addEventListener("change", () => {
  const selected = inventoryRows.find((row) => row.product_id === Number(document.getElementById("inventoryProduct").value));
  document.getElementById("inventoryReorderLevel").value = String(selected?.reorder_level || 0);
  document.getElementById("inventoryQuantity").value = selected?.is_initialized ? "" : "0";
  syncInventoryMovementOptions();
});
document.getElementById("inventoryMovementType").addEventListener("change", syncInventoryMovementOptions);
document.getElementById("closeInventoryDialog").addEventListener("click", () => inventoryDialog.close());
document.getElementById("cancelInventoryMovement").addEventListener("click", () => inventoryDialog.close());
document.getElementById("inventoryMovementForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = document.getElementById("saveInventoryMovement");
  const quantity = Number(document.getElementById("inventoryQuantity").value);
  const reorderLevel = Number(document.getElementById("inventoryReorderLevel").value);
  if (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(reorderLevel) || reorderLevel < 0) {
    showToast("أدخل كميات صحيحة بدون كسور.");
    return;
  }

  saveButton.disabled = true;
  try {
    const { error } = await supabaseClient.rpc("record_inventory_movement", {
      p_product_id: Number(document.getElementById("inventoryProduct").value),
      p_movement_type: document.getElementById("inventoryMovementType").value,
      p_quantity: quantity,
      p_reorder_level: reorderLevel,
      p_notes: document.getElementById("inventoryMovementNotes").value.trim() || null,
    });
    if (error) throw error;
    inventoryDialog.close();
    await loadInventory();
    showToast("تم تسجيل حركة المخزن.");
  } catch (error) {
    console.error("تعذر تسجيل حركة المخزن.", error);
    showToast(inventoryErrorMessage(error));
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById("refreshAccounts").addEventListener("click", loadAccounts);
document.getElementById("addAccountEntry").addEventListener("click", openAccountEntryDialog);
document.getElementById("refreshInquiries").addEventListener("click", loadInquiries);
document.getElementById("inquiryStatusFilter").addEventListener("change", () => {
  inquiriesPage = 0;
  loadInquiries({ page: 0 });
});
document.getElementById("previousInquiriesPage").addEventListener("click", () => {
  if (inquiriesPage > 0) loadInquiries({ page: inquiriesPage - 1 });
});
document.getElementById("nextInquiriesPage").addEventListener("click", () => {
  if ((inquiriesPage + 1) * INQUIRY_PAGE_SIZE < inquiriesTotalCount) {
    loadInquiries({ page: inquiriesPage + 1 });
  }
});
document.getElementById("inquiriesTableBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-open-inquiry]");
  if (!button) return;
  const inquiry = productInquiries.find((item) => String(item.id) === button.dataset.openInquiry);
  if (inquiry) openInquiryDetails(inquiry);
});
document.getElementById("closeInquiryDetails").addEventListener("click", () => inquiryDetailsDialog.close());
document.getElementById("cancelInquiryDetails").addEventListener("click", () => inquiryDetailsDialog.close());
inquiryDetailsDialog.addEventListener("click", (event) => {
  if (event.target === inquiryDetailsDialog) inquiryDetailsDialog.close();
});
document.getElementById("inquiryDetailsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedInquiry) return;
  const saveButton = document.getElementById("saveInquiryStatus");
  saveButton.disabled = true;
  try {
    const { error } = await supabaseClient.from("product_inquiries")
      .update({ status: document.getElementById("inquiryDetailsStatus").value })
      .eq("id", selectedInquiry.id);
    if (error) throw error;
    inquiryDetailsDialog.close();
    selectedInquiry = null;
    await loadInquiries({ page: 0 });
    if (location.hash === "#analytics") await loadBusinessAnalytics();
    showToast("تم تحديث حالة الاستفسار.");
  } catch (error) {
    console.error("تعذر تحديث حالة الاستفسار.", error);
    showToast("تعذر تحديث حالة الاستفسار. حاول مرة أخرى.");
  } finally {
    saveButton.disabled = false;
  }
});
document.getElementById("refreshAnalytics").addEventListener("click", loadBusinessAnalytics);
document.getElementById("analyticsRange").addEventListener("change", loadBusinessAnalytics);
document.getElementById("accountEntryType").addEventListener("change", updateAccountCategoryOptions);
document.getElementById("closeAccountEntryDialog").addEventListener("click", () => accountEntryDialog.close());
document.getElementById("cancelAccountEntry").addEventListener("click", () => accountEntryDialog.close());
document.getElementById("accountEntryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = document.getElementById("saveAccountEntry");
  const amount = Number(document.getElementById("accountEntryAmount").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("أدخل مبلغاً أكبر من صفر.");
    return;
  }

  saveButton.disabled = true;
  try {
    const { error } = await supabaseClient.from("account_entries").insert({
      entry_type: document.getElementById("accountEntryType").value,
      category: document.getElementById("accountEntryCategory").value,
      amount,
      payment_method: document.getElementById("accountEntryPaymentMethod").value,
      entry_date: document.getElementById("accountEntryDate").value,
      order_id: document.getElementById("accountEntryOrder").value || null,
      reference: document.getElementById("accountEntryReference").value.trim() || null,
      notes: document.getElementById("accountEntryNotes").value.trim() || null,
    });
    if (error) throw error;
    accountEntryDialog.close();
    await loadAccounts();
    showToast("تم حفظ الحركة المالية.");
  } catch (error) {
    console.error("تعذر حفظ الحركة المالية.", error);
    showToast("تعذر حفظ الحركة المالية. تحقق من إعداد قاعدة البيانات والحقول.");
  } finally {
    saveButton.disabled = false;
  }
});

function renderOrderDetails(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const itemCards = items.map((item) => {
    const product = productsById.get(String(item.product_id));
    const imageSource = String(product?.image || "").trim();
    const imageUrl = imageSource ? safeImageUrl(imageSource) : "";
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;

    return `
      <article class="order-detail-item">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
          : `<div class="order-detail-image-placeholder">لا توجد صورة</div>`}
        <div class="order-detail-item-info">
          <strong>${escapeHtml(item.name)}</strong>
          <span>الكمية: ${escapeHtml(quantity)}</span>
          <span>سعر القطعة: ${formatMoney(unitPrice)}</span>
          <strong>الإجمالي: ${formatMoney(unitPrice * quantity)}</strong>
        </div>
      </article>
    `;
  }).join("");
  const returnSummary = (order.returnLines || []).length
    ? `<section class="order-return-summary">
        <h3>المرتجعات المسجلة</h3>
        <p><strong>إجمالي المبلغ المردود:</strong> ${formatMoney(order.returnRefundTotal)}</p>
        ${(order.returnLines || []).map((line) => `
          <p>${escapeHtml(line.product_name_snapshot)} · الكمية المرتجعة: ${formatCount(line.quantity)} · ${line.disposition === "restock" ? "صالحة لإعادة البيع ومضافة إلى المخزون" : "تالفة ولم تُضف إلى المخزون المتاح"}</p>
        `).join("")}
      </section>`
    : "";
  const customerName = `${order.first_name} ${order.last_name}`.trim();
  const createdAt = new Date(order.created_at);
  const formattedDate = Number.isNaN(createdAt.getTime())
    ? "—"
    : createdAt.toLocaleString("ar-EG");

  document.getElementById("orderDetailsTitle").textContent =
    `تفاصيل الطلب ${String(order.id).slice(0, 8)}`;
  document.getElementById("orderDetailsContent").innerHTML = `
    <section class="order-detail-customer">
      <h3>بيانات العميل</h3>
      <p><strong>الاسم:</strong> ${escapeHtml(customerName)}</p>
      <p><strong>الهاتف:</strong> <span dir="ltr">${escapeHtml(order.phone)}</span></p>
      <p><strong>العنوان:</strong> ${escapeHtml([order.governorate, order.city, order.address, order.building, order.floor, order.apartment].filter(Boolean).join("، ") || "—")}</p>
      <p><strong>ملاحظات:</strong> ${escapeHtml(order.notes || "—")}</p>
      <p><strong>الحالة:</strong> ${escapeHtml(getOrderStatusLabel(order.status))}</p>
      <p><strong>التاريخ:</strong> ${escapeHtml(formattedDate)}</p>
    </section>
    <section class="order-detail-products">
      <h3>المنتجات</h3>
      ${itemCards || `<p class="orders-empty">لا توجد منتجات مسجلة في هذا الطلب.</p>`}
      <div class="order-detail-totals">
        <p><span>المجموع الفرعي</span><strong>${formatMoney(order.subtotal)}</strong></p>
        <p><span>التوصيل</span><strong>${formatMoney(order.shipping)}</strong></p>
        <p class="order-detail-total"><span>إجمالي الطلب</span><strong>${formatMoney(order.total)}</strong></p>
      </div>
    </section>
    ${returnSummary}
  `;
  orderDetailsDialog.showModal();
}

function updateOrderReturnPreview() {
  if (!returnOrder) return;
  const selected = [...orderReturnDialog.querySelectorAll("[data-return-quantity]")]
    .map((input) => ({
      quantity: Number(input.value),
      unitPrice: Number(input.dataset.unitPrice),
    }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
  const amount = selected.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const count = selected.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById("orderReturnRefundPreview").textContent = count
    ? `إجمالي القطع: ${formatCount(count)} · المبلغ المردود: ${formatMoney(amount)} · لا يشمل الشحن`
    : "اختر الكميات المرتجعة؛ سيُرد سعر المنتجات فقط من دون رسوم الشحن.";
  document.getElementById("saveOrderReturn").disabled = count === 0;
}

function openOrderReturnDialog(order) {
  if (!order || order.status !== "delivered") {
    showToast("يمكن تسجيل مرتجع للطلبات التي تم تسليمها فقط.");
    return;
  }
  const state = getOrderReturnState(order);
  if (state.remaining < 1) {
    showToast("تم تسجيل مرتجع لكل كميات هذا الطلب بالفعل.");
    return;
  }

  returnOrder = order;
  returnRequestKey = crypto.randomUUID();
  document.getElementById("orderReturnTitle").textContent = `تسجيل مرتجع للطلب ${String(order.id).slice(0, 8)}`;
  document.getElementById("orderReturnIntro").textContent =
    `الطلب ${String(order.id).slice(0, 8)} تم تسليمه. اختر المنتجات والكميات؛ الكمية المتبقية القابلة للإرجاع ${formatCount(state.remaining)} قطعة.`;
  document.getElementById("orderReturnPaymentMethod").value = "other";
  document.getElementById("orderReturnNotes").value = "";

  document.getElementById("orderReturnItems").innerHTML = state.products.map((item) => {
    const alreadyReturned = Number(order.returnedQuantities?.[item.productId] || 0);
    const remaining = Math.max(0, item.quantity - alreadyReturned);
    const priceInvalid = !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || item.hasMixedPrices;
    return `
      <article class="return-item-card">
        <div class="return-item-description">
          <strong>${escapeHtml(item.name)}</strong>
          <span>الكمية الأصلية: ${formatCount(item.quantity)} · المرتجع سابقاً: ${formatCount(alreadyReturned)}</span>
          <span>سعر القطعة: ${formatMoney(item.unitPrice)}</span>
          ${remaining === 0 ? '<span class="return-item-exhausted">اكتملت الكمية المرتجعة</span>' : ""}
          ${priceInvalid ? '<span class="inventory-checkout-warning">تعذر تحديد سعر موحد لهذا المنتج في الطلب.</span>' : ""}
        </div>
        ${remaining > 0 ? `
          <label>الكمية المرتجعة
            <input type="number" min="0" max="${remaining}" step="1" value="0"
              data-return-quantity data-product-id="${item.productId}"
              data-unit-price="${Number.isFinite(item.unitPrice) ? item.unitPrice : 0}"
              ${priceInvalid ? "disabled" : ""} />
          </label>
          <label>حالة المنتج
            <select data-return-disposition data-product-id="${item.productId}" ${priceInvalid ? "disabled" : ""}>
              <option value="restock">صالح لإعادة البيع</option>
              <option value="damaged">تالف</option>
            </select>
          </label>
        ` : '<span class="return-item-exhausted">لا توجد كمية متبقية</span>'}
      </article>
    `;
  }).join("");
  orderReturnDialog.showModal();
  updateOrderReturnPreview();
}

function orderReturnErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("ORDER_RETURN_NOT_AUTHORIZED")) return "حسابك غير مصرح له بتسجيل مرتجع.";
  if (message.includes("ORDER_RETURN_ORDER_NOT_FOUND")) return "الطلب غير موجود.";
  if (message.includes("ORDER_RETURN_ORDER_NOT_DELIVERED")) return "يمكن تسجيل مرتجع للطلبات التي تم تسليمها فقط.";
  if (message.includes("ORDER_RETURN_PRODUCT_NOT_IN_ORDER")) return "المنتج المحدد غير موجود في هذا الطلب.";
  if (message.includes("ORDER_RETURN_QUANTITY_EXCEEDED")) return "الكمية أكبر من الكمية المتبقية للإرجاع. حدّث الطلب وحاول مرة أخرى.";
  if (message.includes("ORDER_RETURN_INVENTORY_NOT_READY")) return "لا يمكن إعادة المنتج للمخزون قبل تسجيل جرد المنتج.";
  if (message.includes("ORDER_RETURN_PRICE_MISSING")) return "تعذر تحديد سعر المنتج في الطلب؛ لم يتم تسجيل المرتجع.";
  if (message.includes("ORDER_RETURN_IDEMPOTENCY_CONFLICT")) return "مفتاح تسجيل المرتجع مستخدم لبيانات مختلفة؛ أغلق النافذة وأعد فتحها.";
  return "تعذر حفظ المرتجع. لم تتغير الكمية أو الحسابات؛ حدّث الطلب ثم حاول مرة أخرى.";
}

document.getElementById("ordersTableBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-order-return]");
  if (!button) return;
  const order = orders.find((item) => String(item.id) === button.dataset.orderReturn);
  openOrderReturnDialog(order);
});

document.getElementById("orderReturnItems").addEventListener("input", (event) => {
  const input = event.target.closest("[data-return-quantity]");
  if (input) {
    const maximum = Number(input.max);
    if (Number(input.value) > maximum) input.value = String(maximum);
    updateOrderReturnPreview();
  }
});

document.getElementById("returnAllRemaining").addEventListener("click", () => {
  orderReturnDialog.querySelectorAll("[data-return-quantity]").forEach((input) => {
    input.value = input.max;
  });
  updateOrderReturnPreview();
});

document.getElementById("orderReturnForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!returnOrder || !returnRequestKey) return;
  const items = [...orderReturnDialog.querySelectorAll("[data-return-quantity]")]
    .map((input) => ({
      product_id: Number(input.dataset.productId),
      quantity: Number(input.value),
      disposition: orderReturnDialog.querySelector(`[data-return-disposition][data-product-id="${input.dataset.productId}"]`)?.value || "restock",
    }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
  if (!items.length) {
    showToast("اختر كمية واحدة على الأقل لتسجيل المرتجع.");
    return;
  }

  const saveButton = document.getElementById("saveOrderReturn");
  saveButton.disabled = true;
  try {
    const { error } = await supabaseClient.rpc("record_order_return", {
      p_request_key: returnRequestKey,
      p_order_id: returnOrder.id,
      p_items: items,
      p_payment_method: document.getElementById("orderReturnPaymentMethod").value,
      p_notes: document.getElementById("orderReturnNotes").value.trim() || null,
    });
    if (error) throw error;
    orderReturnDialog.close();
    returnOrder = null;
    returnRequestKey = "";
    await Promise.all([loadOrders(), loadInventory(), loadAccounts()]);
    showToast("تم تسجيل المرتجع وتحديث المخزون والحسابات.");
  } catch (error) {
    console.error("تعذر تسجيل مرتجع الطلب.", error);
    showToast(orderReturnErrorMessage(error));
  } finally {
    saveButton.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  const detailsButton = event.target.closest("button[data-order-details]");
  if (!detailsButton) return;
  const order = orders.find((item) => String(item.id) === detailsButton.dataset.orderDetails);
  if (order) renderOrderDetails(order);
});

document.getElementById("closeOrderDetails").addEventListener("click", () => {
  orderDetailsDialog.close();
});

orderDetailsDialog.addEventListener("click", (event) => {
  if (event.target === orderDetailsDialog) orderDetailsDialog.close();
});

document.getElementById("closeOrderReturn").addEventListener("click", () => orderReturnDialog.close());
document.getElementById("cancelOrderReturn").addEventListener("click", () => orderReturnDialog.close());
orderReturnDialog.addEventListener("click", (event) => {
  if (event.target === orderReturnDialog) orderReturnDialog.close();
});
orderReturnDialog.addEventListener("close", () => {
  returnOrder = null;
  returnRequestKey = "";
});

document.getElementById("viewAllOrders").addEventListener("click", (event) => {
  event.preventDefault();
  ordersPage = 0;
  location.hash = "orders";
  showAdminView("orders");
});

document.getElementById("previousOrdersPage").addEventListener("click", () => {
  if (ordersPage === 0) return;
  loadOrders({ page: ordersPage - 1 });
});

document.getElementById("nextOrdersPage").addEventListener("click", () => {
  if ((ordersPage + 1) * ORDERS_PAGE_SIZE >= ordersTotalCount) return;
  loadOrders({ page: ordersPage + 1 });
});

function openStatusWhatsAppPrompt(order, status) {
  const phone = normalizeDigits(order.phone).replace(/\D/g, "");
  const whatsappPhone = phone.startsWith("20")
    ? phone
    : `20${phone.startsWith("0") ? phone.slice(1) : phone}`;
  const customerName = `${order.first_name} ${order.last_name}`.trim();
  const message = [
    `مرحباً ${customerName}،`,
    ORDER_STATUS_MESSAGES[status],
    `رقم الطلب: ${String(order.id).slice(0, 8)}`,
    `الحالة: ${ORDER_STATUSES[status]}`,
    `الإجمالي: ${formatMoney(order.total)}`,
  ].join("\n");
  const sendButton = document.getElementById("sendStatusWhatsApp");
  const phoneIsValid = /^20\d{10}$/.test(whatsappPhone);

  document.getElementById("statusWhatsAppMessage").textContent = message;
  document.getElementById("statusWhatsAppPhoneNote").textContent = phoneIsValid
    ? `سيتم فتح محادثة واتساب مع ${customerName}.`
    : "رقم الهاتف غير صالح لفتح واتساب. تحقق من رقم العميل في تفاصيل الطلب.";
  sendButton.href = phoneIsValid
    ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`
    : "#";
  sendButton.classList.toggle("disabled", !phoneIsValid);
  sendButton.setAttribute("aria-disabled", String(!phoneIsValid));
  statusWhatsAppDialog.showModal();
}

document.getElementById("closeStatusWhatsApp").addEventListener("click", () => {
  statusWhatsAppDialog.close();
});

document.getElementById("cancelStatusWhatsApp").addEventListener("click", () => {
  statusWhatsAppDialog.close();
});

document.getElementById("sendStatusWhatsApp").addEventListener("click", (event) => {
  if (event.currentTarget.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
  } else {
    statusWhatsAppDialog.close();
  }
});

document.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-order-id]");
  if (!select) return;

  const previousStatus = select.dataset.currentStatus;
  const nextStatus = select.value;
  const order = orders.find((item) => String(item.id) === select.dataset.orderId);
  if (!order || nextStatus === previousStatus) return;
  select.disabled = true;
  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({ status: nextStatus })
      .eq("id", select.dataset.orderId);
    if (error) throw error;
    order.status = nextStatus;
    renderOrders();
    if (ORDER_STATUS_MESSAGES[nextStatus]) {
      openStatusWhatsAppPrompt(order, nextStatus);
    } else {
      showToast("تم تحديث حالة الطلب");
    }
  } catch (error) {
    console.error("تعذر تحديث حالة الطلب.", error);
    renderOrders();
    const message = String(error?.message || "");
    if (message.includes("INVENTORY_OPENING_REQUIRED")) {
      showToast("أدخل الرصيد الافتتاحي للمنتجات في المخزن قبل تأكيد الطلب.");
    } else if (message.includes("INVENTORY_INSUFFICIENT_AVAILABLE")) {
      showToast("لا يمكن تأكيد الطلب: بعض المنتجات غير متاحة بالكمية المطلوبة.");
    } else if (message.includes("ORDER_STATUS_TRANSITION_INVALID")) {
      showToast("انتقل بالطلب إلى الحالة التالية في مسار الطلبات.");
    } else if (message.includes("ORDER_FULFILLED_CANNOT_REOPEN")) {
      showToast("لا يمكن إعادة فتح طلب تم شحنه أو تسليمه.");
    } else {
      showToast("تعذر تحديث حالة الطلب. حاول مرة أخرى.");
    }
  } finally {
    select.disabled = false;
  }
});

menuToggle.addEventListener("click", () => {
  setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
});

sidebarBackdrop.addEventListener("click", () => setMenuOpen(false));

adminNavigation.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  if (link.hash) showAdminView(link.hash.slice(1));
  setMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
    setMenuOpen(false);
    menuToggle.focus();
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  let email;
  try {
    email = usernameToAuthEmail(document.getElementById("username").value);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const password = document.getElementById("password").value;
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user?.app_metadata?.role !== "admin") {
      await supabaseClient.auth.signOut();
      showToast("هذا الحساب غير مصرح له بإدارة المتجر");
      return;
    }

    isAdmin = true;
    updateAuthUI();
    await loadProducts();
    location.hash = "dashboard";
    showAdminView("dashboard");
    loginForm.reset();
    showToast("تم تسجيل الدخول");
  } catch (error) {
    console.error("فشل تسجيل دخول الإدارة.", error);
    showToast("تعذر تسجيل الدخول. تحقق من البيانات أو إعدادات الإدارة.");
  } finally {
    submitButton.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error("تعذر تسجيل الخروج.", error);
    showToast("تعذر تسجيل الخروج. حاول مرة أخرى.");
    return;
  }

  isAdmin = false;
  products = [];
  orders = [];
  inventoryRows = [];
  productInquiries = [];
  selectedInquiry = null;
  document.getElementById("analyticsCustomersBody").replaceChildren();
  renderTable();
  updateAuthUI();
  showToast("تم تسجيل الخروج");
});

async function initializeAdmin() {
  updateAuthUI();
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      resetForm();
      return;
    }

    const { data, error } = await supabaseClient.auth.getUser();
    if (error) throw error;
    isAdmin = data.user?.app_metadata?.role === "admin";
    updateAuthUI();
    if (isAdmin) {
      await loadProducts();
      showAdminView(location.hash.slice(1) || "dashboard");
    }
    resetForm();
  } catch (error) {
    console.error("تعذر التحقق من جلسة الإدارة.", error);
    isAdmin = false;
    updateAuthUI();
    showToast("تعذر التحقق من جلسة الدخول. سجل الدخول مرة أخرى.");
  }
}

initializeAdmin();
