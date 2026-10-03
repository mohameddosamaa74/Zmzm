import { supabaseClient, supabaseConfigurationError } from "../../supabase-config.js";
import { escapeHtml, safeImageUrl } from "./safe-dom.js";
import { usernameToAuthEmail } from "./admin-auth.js";

const PRODUCT_FIELDS = "id,name,category,price,old_price,tag,meta,rating,specs,image,type";
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
const logoutBtn = document.getElementById("logoutBtn");
const productImageInput = document.getElementById("productImage");
const productImagePreview = document.getElementById("productImagePreview");
const imagePreviewText = document.getElementById("imagePreviewText");
const currentImageInput = document.getElementById("currentImage");
let products = [];
let orders = [];
let isAdmin = false;
const ORDER_STATUSES = {
  pending: "جديد",
  confirmed: "تم التأكيد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;
}

function normalizeProduct(row) {
  return {
    ...row,
    id: Number(row.id),
    name: String(row.name || ""),
    category: categoryNames[row.category] ? row.category : "boxes",
    price: Number(row.price),
    old: Number(row.old_price || 0),
    tag: String(row.tag || ""),
    meta: String(row.meta || ""),
    rating: Number(row.rating || 4.8),
    specs: row.specs || {},
    image: String(row.image || ""),
    type: String(row.type || "box"),
  };
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
    dashboard: { element: document.getElementById("dashboardView"), title: "إدارة المنتجات" },
    products: { element: document.getElementById("products"), title: "المنتجات" },
    orders: { element: document.getElementById("orders"), title: "الطلبات" },
  };
  const selectedView = views[view] || views.dashboard;
  for (const [name, item] of Object.entries(views)) {
    item.element.classList.toggle("hidden", item !== selectedView);
    adminNavigation.querySelector(`[href="#${name}"]`)?.classList.toggle("active", item === selectedView);
  }
  document.querySelector(".topbar h1").textContent = selectedView.title;
  if (view === "orders") loadOrders();
}

function renderStats() {
  document.getElementById("totalProducts").textContent = String(products.length);
  document.getElementById("boardsCount").textContent = String(products.filter((item) => item.category === "boards").length);
  document.getElementById("boxesCount").textContent = String(products.filter((item) => item.category === "boxes").length);
  document.getElementById("packagingCount").textContent = String(products.filter((item) => item.category === "packaging").length);
}

function renderTable() {
  productTableBody.innerHTML = products.map((product) => `
    <tr>
      <td><strong>${escapeHtml(product.name)}</strong></td>
      <td>${escapeHtml(categoryNames[product.category] || product.category)}</td>
      <td>${formatMoney(product.price)}</td>
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

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select(PRODUCT_FIELDS)
    .order("id", { ascending: false });

  if (error) throw error;
  products = (data || []).map(normalizeProduct);
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
}

function renderOrders() {
  const rows = orders.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemSummary = items.map((item) =>
      `${escapeHtml(item.name)} × ${escapeHtml(item.quantity)} (${formatMoney(item.unit_price)})`
    ).join("<br>");
    const customerName = `${order.first_name} ${order.last_name}`.trim();
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
        <td>${itemSummary || "—"}</td>
        <td>${escapeHtml(order.notes || "—")}</td>
        <td>${formatMoney(order.total)}</td>
        <td>
          <select class="order-status" data-order-id="${escapeHtml(order.id)}" data-current-status="${escapeHtml(order.status)}" aria-label="حالة الطلب">
            ${Object.entries(ORDER_STATUSES).map(([value, label]) =>
              `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`
            ).join("")}
          </select>
        </td>
        <td>${escapeHtml(formattedDate)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("ordersTableBody").innerHTML = rows;
  document.getElementById("ordersEmpty").classList.toggle("hidden", orders.length > 0);
}

async function loadOrders() {
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  const refreshButton = document.getElementById("refreshOrders");
  refreshButton.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("id,created_at,first_name,last_name,phone,governorate,city,address,building,floor,apartment,notes,items,total,status")
      .order("created_at", { ascending: false });
    if (error) throw error;
    orders = data || [];
    renderOrders();
  } catch (error) {
    console.error("تعذر تحميل الطلبات من Supabase.", error);
    showToast("تعذر تحميل الطلبات. تأكد من تطبيق إعداد جدول الطلبات في Supabase.");
  } finally {
    refreshButton.disabled = false;
  }
}

function fillForm(product) {
  document.getElementById("productId").value = String(product.id);
  document.getElementById("name").value = product.name;
  document.getElementById("category").value = product.category;
  document.getElementById("price").value = String(product.price);
  document.getElementById("oldPrice").value = product.old ? String(product.old) : "";
  document.getElementById("tag").value = product.tag;
  document.getElementById("rating").value = String(product.rating);
  document.getElementById("meta").value = product.meta;
  document.getElementById("specs").value = JSON.stringify(product.specs, null, 2);
  currentImageInput.value = product.image;
  setImagePreview(product.image);
  formTitle.textContent = "تعديل المنتج";
  document.getElementById("saveProduct").textContent = "تحديث المنتج";
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

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = document.getElementById("productId").value;
  const name = document.getElementById("name").value.trim();
  const meta = document.getElementById("meta").value.trim();
  const price = Number(document.getElementById("price").value);
  const oldPriceValue = document.getElementById("oldPrice").value;
  const oldPrice = oldPriceValue ? Number(oldPriceValue) : null;
  const specsText = document.getElementById("specs").value.trim();
  let specs = {};

  if (!name || !meta || !Number.isFinite(price) || price <= 0 ||
      (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < 0))) {
    showToast("تحقق من اسم المنتج ووصفه وسعره");
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

  try {
    const query = productId
      ? supabaseClient.from("products").update(payload).eq("id", Number(productId))
      : supabaseClient.from("products").insert(payload);
    const { data, error } = await query.select(PRODUCT_FIELDS).single();
    if (error) throw error;

    const savedProduct = normalizeProduct(data);
    products = productId
      ? products.map((product) => product.id === savedProduct.id ? savedProduct : product)
      : [savedProduct, ...products];
    renderTable();
    resetForm();
    showToast(productId ? "تم تحديث المنتج" : "تمت إضافة المنتج");
  } catch (error) {
    console.error("تعذر حفظ المنتج في Supabase.", error);
    showToast("تعذر حفظ المنتج. لم يتم تغيير البيانات.");
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById("addProductButton").addEventListener("click", () => {
  resetForm();
  productDialog.showModal();
});

document.getElementById("closeProductDialog").addEventListener("click", resetForm);
document.getElementById("cancelProductDialog").addEventListener("click", resetForm);

productDialog.addEventListener("click", (event) => {
  if (event.target === productDialog) resetForm();
});

productDialog.addEventListener("cancel", () => resetForm());

document.getElementById("refreshOrders").addEventListener("click", loadOrders);

document.getElementById("ordersTableBody").addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-order-id]");
  if (!select) return;

  const previousStatus = select.dataset.currentStatus;
  select.disabled = true;
  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({ status: select.value })
      .eq("id", select.dataset.orderId);
    if (error) throw error;
    select.dataset.currentStatus = select.value;
    const order = orders.find((item) => item.id === select.dataset.orderId);
    if (order) order.status = select.value;
    showToast("تم تحديث حالة الطلب");
  } catch (error) {
    console.error("تعذر تحديث حالة الطلب.", error);
    select.value = previousStatus;
    showToast("تعذر تحديث حالة الطلب. حاول مرة أخرى.");
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
    showAdminView(location.hash.slice(1) || "products");
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
      showAdminView(location.hash.slice(1) || "products");
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
