import { supabaseClient, supabaseConfigurationError } from "../../supabase-config.js";
import { escapeHtml, safeImageUrl } from "./safe-dom.js";

const PRODUCT_FIELDS = "id,name,category,price,old_price,tag,meta,rating,specs,image,type";
const categoryNames = {
  boards: "ألواح الكيك",
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
const logoutBtn = document.getElementById("logoutBtn");
const productImageInput = document.getElementById("productImage");
const productImagePreview = document.getElementById("productImagePreview");
const imagePreviewText = document.getElementById("imagePreviewText");
const currentImageInput = document.getElementById("currentImage");
let products = [];
let isAdmin = false;

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
  document.getElementById("productId").value = "";
  currentImageInput.value = "";
  productImageInput.value = "";
  setImagePreview("");
  formTitle.textContent = "إضافة منتج";
  document.getElementById("saveProduct").textContent = "حفظ المنتج";
  document.getElementById("rating").value = "4.8";
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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

document.getElementById("cancelEdit").addEventListener("click", resetForm);

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    showToast(supabaseConfigurationError);
    return;
  }

  const email = document.getElementById("email").value.trim();
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
    if (isAdmin) await loadProducts();
    resetForm();
  } catch (error) {
    console.error("تعذر التحقق من جلسة الإدارة.", error);
    isAdmin = false;
    updateAuthUI();
    showToast("تعذر التحقق من جلسة الدخول. سجل الدخول مرة أخرى.");
  }
}

initializeAdmin();
