const ADMIN_AUTH_KEY = "zmzm-admin-auth";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "zmzm123";
const STORAGE_KEY = "zmzm-products";
const supabaseConfig = window.ZMZAM_SUPABASE || { enabled: false };
const supabaseClient = supabaseConfig.enabled && window.supabase ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey) : null;
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

const productForm = document.getElementById("productForm");
const productTableBody = document.getElementById("productTableBody");
const toast = document.getElementById("toast");
const formTitle = document.getElementById("formTitle");
const cancelEditBtn = document.getElementById("cancelEdit");
const resetDemoBtn = document.getElementById("resetDemo");
const loginForm = document.getElementById("loginForm");
const authScreen = document.getElementById("authScreen");
const adminShell = document.getElementById("adminShell");
const logoutBtn = document.getElementById("logoutBtn");

const categoryNames = {
  boards: "ألواح الكيك",
  boxes: "علب الكيك",
  cupcakes: "كب كيك",
  packaging: "تغليف"
};

function getProductsFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (error) {
      console.warn("لم يتم قراءة بيانات المنتجات، سيتم العودة إلى البيانات الافتراضية.");
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProducts));
  return defaultProducts;
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
    type: row.type || (row.category === "boards" ? "goldboard" : row.category === "cupcakes" ? "cup" : row.category === "packaging" ? "ribbon" : "box")
  };
}

async function loadProductsFromSupabase() {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.from("products").select("*").order("id", { ascending: false });
  if (error) {
    console.warn("Supabase load failed:", error.message);
    return null;
  }
  return data.map(normalizeProduct);
}

async function saveProductsToSupabase() {
  if (!supabaseClient) return false;
  const payload = products.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: Number(product.price || 0),
    old_price: product.old || null,
    tag: product.tag || null,
    meta: product.meta || "",
    rating: Number(product.rating || 4.8),
    specs: product.specs || {},
    type: product.type || "box"
  }));

  const { error } = await supabaseClient.from("products").upsert(payload, { onConflict: "id" });
  if (error) {
    console.warn("Supabase save failed:", error.message);
    return false;
  }
  return true;
}

let products = getProductsFromStorage();

function isLoggedIn() {
  return localStorage.getItem(ADMIN_AUTH_KEY) === "true";
}

function setLoggedIn(flag) {
  localStorage.setItem(ADMIN_AUTH_KEY, flag ? "true" : "false");
}

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  authScreen.classList.toggle("hidden", loggedIn);
  adminShell.classList.toggle("hidden", !loggedIn);
}

function saveProducts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ar-EG")} ج.م`;
}

function renderStats() {
  document.getElementById("totalProducts").textContent = products.length;
  document.getElementById("boardsCount").textContent = products.filter((item) => item.category === "boards").length;
  document.getElementById("boxesCount").textContent = products.filter((item) => item.category === "boxes").length;
  document.getElementById("packagingCount").textContent = products.filter((item) => item.category === "packaging").length;
}

function renderTable() {
  productTableBody.innerHTML = products.map((product) => `
    <tr>
      <td><strong>${product.name}</strong></td>
      <td>${categoryNames[product.category] || product.category}</td>
      <td>${formatMoney(product.price)}</td>
      <td>${product.rating || 4.8}</td>
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

function resetForm() {
  productForm.reset();
  document.getElementById("productId").value = "";
  document.getElementById("specs").value = "";
  formTitle.textContent = "إضافة منتج";
  document.getElementById("saveProduct").textContent = "حفظ المنتج";
  document.getElementById("rating").value = "4.8";
}

function fillForm(product) {
  document.getElementById("productId").value = product.id;
  document.getElementById("name").value = product.name;
  document.getElementById("category").value = product.category;
  document.getElementById("price").value = product.price;
  document.getElementById("oldPrice").value = product.old || "";
  document.getElementById("tag").value = product.tag || "";
  document.getElementById("rating").value = product.rating || 4.8;
  document.getElementById("meta").value = product.meta || "";
  const specsValue = product.specs ? (typeof product.specs === "string" ? product.specs : JSON.stringify(product.specs, null, 2)) : "";
  document.getElementById("specs").value = specsValue;
  formTitle.textContent = "تعديل المنتج";
  document.getElementById("saveProduct").textContent = "تحديث المنتج";
}

productTableBody.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  const { action, id } = target.dataset;
  const product = products.find((item) => item.id === Number(id));
  if (!product) return;

  if (action === "edit") {
    fillForm(product);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (action === "delete") {
    products = products.filter((item) => item.id !== Number(id));
    saveProducts();
    renderTable();
    resetForm();
    showToast("تم حذف المنتج بنجاح");
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const productId = document.getElementById("productId").value;
  const specsText = document.getElementById("specs").value.trim();
  let specs = {};

  if (specsText) {
    try {
      specs = JSON.parse(specsText);
    } catch (error) {
      specs = { raw: specsText };
    }
  }

  const productData = {
    name: document.getElementById("name").value.trim(),
    category: document.getElementById("category").value,
    price: Number(document.getElementById("price").value),
    old: Number(document.getElementById("oldPrice").value || 0),
    tag: document.getElementById("tag").value.trim(),
    meta: document.getElementById("meta").value.trim(),
    rating: Number(document.getElementById("rating").value || 4.8),
    specs,
    type: "box"
  };

  if (!productData.name || !productData.meta || !productData.price) {
    showToast("يرجى تعبئة الحقول الأساسية");
    return;
  }

  if (productId) {
    products = products.map((product) =>
      product.id === Number(productId)
        ? { ...product, ...productData }
        : product
    );
    showToast("تم تحديث المنتج بنجاح");
  } else {
    const newId = products.length ? Math.max(...products.map((item) => item.id)) + 1 : 1;
    products.unshift({ ...productData, id: newId, type: productData.category === "boards" ? "goldboard" : productData.category === "cupcakes" ? "cup" : productData.category === "packaging" ? "ribbon" : "box" });
    showToast("تمت إضافة المنتج بنجاح");
  }

  saveProducts();
  if (supabaseClient) {
    await saveProductsToSupabase();
  }
  renderTable();
  resetForm();
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
});

resetDemoBtn.addEventListener("click", async () => {
  products = [...defaultProducts];
  saveProducts();
  if (supabaseClient) {
    await saveProductsToSupabase();
  }
  renderTable();
  resetForm();
  showToast("تمت استعادة البيانات التجريبية");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from("admin_credentials")
      .select("*")
      .eq("username", username)
      .eq("password", password)
      .maybeSingle();

    if (!error && data) {
      setLoggedIn(true);
      updateAuthUI();
      showToast("تم تسجيل الدخول بنجاح");
      document.getElementById("loginForm").reset();
      return;
    }
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    setLoggedIn(true);
    updateAuthUI();
    showToast("تم تسجيل الدخول بنجاح");
    document.getElementById("loginForm").reset();
    return;
  }

  showToast("اسم المستخدم أو كلمة المرور غير صحيحة");
});

logoutBtn.addEventListener("click", () => {
  setLoggedIn(false);
  updateAuthUI();
  showToast("تم تسجيل الخروج");
});

async function initializeAdmin() {
  if (supabaseClient) {
    const remoteProducts = await loadProductsFromSupabase();
    if (remoteProducts && remoteProducts.length) {
      products = remoteProducts;
      saveProducts();
    }
  }
  updateAuthUI();
  renderTable();
  resetForm();
}

initializeAdmin();
