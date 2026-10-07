import { supabaseClient } from "../../supabase-config.js";
import { normalizeDigits } from "./safe-dom.js";
import { DELIVERY_TIME_NOTE, FREE_SHIPPING_THRESHOLD, getShippingFee } from "./shipping.js";

const toggle = document.getElementById("storeAssistantToggle");
const panel = document.getElementById("storeAssistantPanel");
const closeButton = document.getElementById("storeAssistantClose");
const form = document.getElementById("storeAssistantForm");
const input = document.getElementById("storeAssistantInput");
const sendButton = document.getElementById("storeAssistantSend");
const messagesView = document.getElementById("storeAssistantMessages");
const suggestions = document.getElementById("storeAssistantSuggestions");

const CACHE_TIME_MS = 15_000;
const STOP_WORDS = new Set([
  "ايه", "هل", "من", "في", "على", "لو", "ما", "ماذا", "ممكن", "عايز", "عاوز", "اريد", "ابغى",
  "عندكم", "عند", "لديكم", "لدي", "كم", "بكام", "سعر", "السعر", "اسعار", "الاسعار", "مقاس",
  "مقاسات", "متاح", "متاحة", "متاحه", "موجود", "موجودة", "موجوده", "متوفر", "متوفرة", "متوفره",
  "المنتج", "منتج", "منتجات", "المنتجات", "صنف", "سلعه", "الكمية", "كمية", "مخزون", "المخزون", "علي", "عايزه", "عاوزه",
  "السلام", "عليكم", "مرحبا", "اهلا", "لو", "سمحت", "بعد", "من", "فضلك", "عايزين", "مع",
  "do", "you", "have", "does", "is", "the", "what", "for", "with", "i", "want", "need", "can",
  "show", "me", "how", "much", "are", "there", "please", "any", "of", "a", "an", "from", "on", "at",
  "looking", "find", "get", "sell", "selling", "your", "our", "currently", "product", "products", "item", "items",
  "cheapest", "cheap", "lowest", "price", "prices", "expensive", "most", "available", "sizes", "size",
  "ارخص", "الارخص", "الاقل", "اغلي", "الاغلي", "الاعلي", "الاكبر", "الاصغر", "متاحه",
]);

const GOVERNORATES = [
  { name: "القاهرة", englishName: "Cairo", aliases: ["القاهرة", "القاهره", "cairo"] },
  { name: "الإسكندرية", englishName: "Alexandria", aliases: ["الإسكندرية", "الاسكندرية", "اسكندرية", "اسكندريه", "alexandria", "alex"] },
  { name: "بورسعيد", englishName: "Port Said", aliases: ["بورسعيد", "بور سعيد", "port said", "portsaid"] },
  { name: "السويس", englishName: "Suez", aliases: ["السويس", "سويس", "suez"] },
  { name: "دمياط", englishName: "Damietta", aliases: ["دمياط", "damietta", "damyat"] },
  { name: "الدقهلية", englishName: "Dakahlia", aliases: ["الدقهلية", "الدقهليه", "dakahlia", "daqahliya"] },
  { name: "الشرقية", englishName: "Sharqia", aliases: ["الشرقية", "الشرقيه", "sharqia", "sharkia"] },
  { name: "القليوبية", englishName: "Qalyubia", aliases: ["القليوبية", "القليوبيه", "qalyubia", "qalubia"] },
  { name: "كفر الشيخ", englishName: "Kafr El Sheikh", aliases: ["كفر الشيخ", "كفرالشيخ", "kafr el sheikh", "kafr el-sheikh"] },
  { name: "الغربية", englishName: "Gharbia", aliases: ["الغربية", "الغربيه", "gharbia"] },
  { name: "المنوفية", englishName: "Menoufia", aliases: ["المنوفية", "المنوفيه", "menoufia", "monufia"] },
  { name: "البحيرة", englishName: "Beheira", aliases: ["البحيرة", "البحيره", "beheira", "behaira"] },
  { name: "الإسماعيلية", englishName: "Ismailia", aliases: ["الإسماعيلية", "الاسماعيلية", "اسماعيلية", "اسماعيليه", "ismailia", "ismailiya"] },
  { name: "الجيزة", englishName: "Giza", aliases: ["الجيزة", "الجيزه", "giza"] },
  { name: "بني سويف", englishName: "Beni Suef", aliases: ["بني سويف", "ben suef", "beni suef", "beni sweif", "beni suweif"] },
  { name: "الفيوم", englishName: "Fayoum", aliases: ["الفيوم", "fayoum", "faiyum"] },
  { name: "المنيا", englishName: "Minya", aliases: ["المنيا", "minya", "menia"] },
  { name: "أسيوط", englishName: "Assiut", aliases: ["أسيوط", "اسيوط", "assiut", "asyut"] },
  { name: "سوهاج", englishName: "Sohag", aliases: ["سوهاج", "سوهج", "sohag", "suhag", "suhaj"] },
  { name: "قنا", englishName: "Qena", aliases: ["قنا", "qena", "kina"] },
  { name: "الأقصر", englishName: "Luxor", aliases: ["الأقصر", "الاقصر", "luxor"] },
  { name: "أسوان", englishName: "Aswan", aliases: ["أسوان", "اسوان", "aswan"] },
  { name: "البحر الأحمر", englishName: "Red Sea", aliases: ["البحر الأحمر", "البحر الاحمر", "red sea"] },
  { name: "الوادي الجديد", englishName: "New Valley", aliases: ["الوادي الجديد", "الوادى الجديد", "new valley", "wadi el gedid", "el wadi el gedid"] },
  { name: "مطروح", englishName: "Matrouh", aliases: ["مطروح", "matrouh", "marsa matrouh"] },
  { name: "شمال سيناء", englishName: "North Sinai", aliases: ["شمال سيناء", "شمال سينا", "north sinai"] },
  { name: "جنوب سيناء", englishName: "South Sinai", aliases: ["جنوب سيناء", "جنوب سينا", "south sinai"] },
];

const CONTACT_NUMBER = "+20 102 431 1053";
const CONTACT_NUMBER_AR = "\u2066+٢٠ ١٠٢ ٤٣١ ١٠٥٣\u2069";
let isSending = false;
let cachedCatalog = null;
let catalogLoadedAt = 0;
let selectedProductId = null;
let inquiryFlow = null;

function normalizeText(value) {
  return normalizeDigits(String(value || ""))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/(\d)[x](\d)/g, "$1 $2")
    .replace(/[×*]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalToken(token) {
  const withoutArticle = token.replace(/^ال(?=.{3,})/, "");
  return ({
    بيضاء: "ابيض",
    بيضا: "ابيض",
    ابيض: "ابيض",
    بيض: "ابيض",
    white: "ابيض",
    ivory: "ابيض",
    beige: "بيج",
    ذهبيه: "ذهبي",
    ذهبي: "ذهبي",
    gold: "ذهبي",
    golden: "ذهبي",
    silver: "فضي",
    cake: "كيك",
    box: "علبه",
    boxes: "علبه",
    علب: "علبه",
    board: "قاعده",
    base: "قاعده",
    قواعد: "قاعده",
    cupcake: "كب",
    cupcakes: "كب",
    دائريه: "دائري",
    دائري: "دائري",
    round: "دائري",
    circular: "دائري",
    square: "مربع",
    مستطيله: "مستطيل",
    مستطيل: "مستطيل",
    rectangular: "مستطيل",
  })[withoutArticle] || withoutArticle;
}

function tokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .map(canonicalToken);
}

function isEnglish(text) {
  const arabicLetters = (String(text || "").match(/[\u0621-\u064A\u066E-\u06D3]/g) || []).length;
  const latinLetters = (String(text || "").match(/[a-z]/gi) || []).length;
  return latinLetters > arabicLetters;
}

function findGovernorate(text) {
  const normalized = normalizeText(text);
  return GOVERNORATES.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(normalizeText(alias)))
  ) || null;
}

function isGovernorateOnlyReply(text) {
  const normalized = normalizeText(text);
  const candidates = [
    normalized,
    normalized.replace(/^(انا|i am|i m|im|i live|my location is)\s+(في|من|in|from)\s+/, ""),
    normalized.replace(/^(my\s+)?(محافظه|governorate|province)(\s+(بتاعتي|my))?\s*(هي|is)?\s*/, ""),
  ];
  return GOVERNORATES.some((entry) => entry.aliases.some((alias) =>
    candidates.includes(normalizeText(alias))
  ));
}

function appendMessage(role, text, extraClass = "") {
  const message = document.createElement("div");
  message.className = `store-assistant-message ${role}${extraClass ? ` ${extraClass}` : ""}`;
  const paragraph = document.createElement("p");
  paragraph.dir = "auto";
  paragraph.textContent = text;
  message.append(paragraph);
  messagesView.append(message);
  messagesView.scrollTop = messagesView.scrollHeight;
  return message;
}

function appendChoiceMessage(text, choices) {
  const message = appendMessage("assistant", text);
  const actions = document.createElement("div");
  actions.className = "store-assistant-confirm-actions";
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.assistantChoice = choice.value;
    button.textContent = choice.label;
    actions.append(button);
  }
  message.append(actions);
  messagesView.scrollTop = messagesView.scrollHeight;
  return message;
}

function startProductSearch() {
  setPanelOpen(true);
  inquiryFlow = { step: "awaiting_product_name" };
  appendMessage("assistant", "اكتب اسم المنتج الذي تبحث عنه. سأتحقق من المنتجات، ولن أرسل استفسارًا إلا بعد تأكيدك.");
  input.focus();
}

function setPanelOpen(isOpen) {
  panel.hidden = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen && window.matchMedia("(pointer: fine)").matches) input.focus();
  if (!isOpen) toggle.focus({ preventScroll: true });
}

function setSending(sending) {
  isSending = sending;
  sendButton.disabled = sending;
  input.disabled = sending;
  sendButton.setAttribute("aria-busy", String(sending));
}

function toProduct(row, availability = null) {
  const rawQuantity = availability?.available_quantity;
  const quantity = rawQuantity === null || rawQuantity === undefined ? null : Number(rawQuantity);
  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    category: String(row.category || ""),
    price: Number(row.price || 0),
    details: String(row.meta || "").trim(),
    specs: row.specs && typeof row.specs === "object" ? row.specs : {},
    available: typeof availability?.available === "boolean" ? availability.available : null,
    quantity: Number.isInteger(quantity) ? Math.max(0, quantity) : null,
  };
}

async function loadCatalog() {
  if (!supabaseClient) throw new Error("catalog_unavailable");
  if (cachedCatalog && Date.now() - catalogLoadedAt < CACHE_TIME_MS) return cachedCatalog;

  let productQuery = await supabaseClient
    .from("products")
    .select("id,name,category,price,meta,specs,sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (productQuery.error && (productQuery.error.code === "42703" || productQuery.error.code === "PGRST204" || /sort_order/i.test(productQuery.error.message || ""))) {
    productQuery = await supabaseClient
      .from("products")
      .select("id,name,category,price,meta,specs")
      .order("id", { ascending: true });
  }
  if (productQuery.error) throw new Error("catalog_unavailable");

  const { data: availabilityRows, error: availabilityError } = await supabaseClient
    .rpc("get_public_product_availability");
  const availability = new Map();
  if (!availabilityError) {
    for (const row of availabilityRows || []) availability.set(Number(row.product_id), row);
  }

  cachedCatalog = (productQuery.data || []).map((product) =>
    toProduct(product, availability.get(Number(product.id)) || null)
  );
  catalogLoadedAt = Date.now();
  return cachedCatalog;
}

function getProductMatches(question, catalog) {
  const questionText = normalizeText(question);
  const questionTokens = [...new Set(tokens(question).filter((token) => !STOP_WORDS.has(token) && token.length > 1))];
  if (!questionTokens.length) return [];

  return catalog
    .map((product) => {
      const nameText = normalizeText(product.name);
      const searchableTokens = new Set(tokens([
        product.name,
        product.details,
        JSON.stringify(product.specs),
        ({ boxes: "box cake", boards: "cake board", cupcakes: "cupcake", packaging: "packaging" })[product.category] || "",
      ].join(" ")));
      const matchedTokens = questionTokens.filter((token) =>
        searchableTokens.has(token) || [...searchableTokens].some((candidate) =>
          candidate.length > 3 && token.length > 3 && (candidate.startsWith(token) || token.startsWith(candidate))
        )
      );
      let score = matchedTokens.length * 2;
      if (nameText && questionText.includes(nameText)) score += 30;
      if (matchedTokens.length === questionTokens.length && matchedTokens.length > 1) score += 3;
      return { product, score, matchedCount: matchedTokens.length };
    })
    .filter((entry) => entry.matchedCount > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function getReliableProductMatches(question, catalog) {
  const questionTokens = [...new Set(tokens(question).filter((token) => !STOP_WORDS.has(token) && token.length > 1))];
  if (!questionTokens.length) return [];
  const questionTokenSet = new Set(questionTokens);

  return getProductMatches(question, catalog).filter((entry) => {
    if (entry.matchedCount >= 2 && entry.matchedCount / questionTokens.length >= 0.8) return true;
    const coreNameTokens = [...new Set(tokens(entry.product.name)
      .filter((token) => !STOP_WORDS.has(token) && token.length > 1 && !/^\d+$/.test(token)))];
    return coreNameTokens.length >= 2 && coreNameTokens.every((token) => questionTokenSet.has(token));
  });
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function tokenSimilarity(left, right) {
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 3) return 0;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function getClosestProduct(productName, catalog) {
  const requestedTokens = [...new Set(tokens(productName).filter((token) =>
    !STOP_WORDS.has(token) && token.length > 1 && !/^\d+$/.test(token)
  ))];
  if (!requestedTokens.length) return null;

  const rankedProducts = catalog.map((product) => {
    const nameTokens = [...new Set(tokens(product.name).filter((token) =>
      !STOP_WORDS.has(token) && token.length > 1 && !/^\d+$/.test(token)
    ))];
    const similarities = requestedTokens.map((requestedToken) =>
      Math.max(0, ...nameTokens.map((nameToken) => tokenSimilarity(requestedToken, nameToken)))
    );
    const exactTokenCount = similarities.filter((similarity) => similarity === 1).length;
    const score = similarities.reduce((total, similarity) => total + similarity, 0) / similarities.length;
    return { product, score, exactTokenCount };
  }).sort((left, right) => right.score - left.score || right.exactTokenCount - left.exactTokenCount);

  const closest = rankedProducts[0];
  if (!closest || (closest.score < 0.58 && !(closest.exactTokenCount >= 1 && closest.score >= 0.45))) return null;
  return closest;
}

function hasProductCue(question) {
  return /(منتج|المنتج|صنف|سلعه|علب|علبه|بوكس|كيك|قاعده|قواعد|لوح|board|box|cake|product|item|cupcake|packaging|size|مقاس|مقاسات|تغليف|كرتون)/i.test(normalizeText(question));
}

function isSizeCatalogQuestion(question) {
  const text = normalizeText(question);
  const withoutSizeWords = text.replace(/مقاسات|المقاس|احجام|حجم|sizes?|dimensions?/gi, "");
  return /(مقاسات|المقاس|احجام|حجم|sizes?|dimensions?)/i.test(text) && !hasProductCue(withoutSizeWords);
}

function getCategoryBrowseIntent(question) {
  const text = normalizeText(question);
  if (/(كب كيك|كبكيك|cup\s*cakes?)/i.test(text)) return "cupcakes";
  if (/(علب|علبه|بوكس|boxes?|cake box)/i.test(text)) return "boxes";
  if (/(قواعد|قاعده|لوح|boards?|bases?)/i.test(text)) return "boards";
  if (/(تغليف|شرائط|ربطه|packaging|ribbons?)/i.test(text)) return "packaging";
  return null;
}

function isBroadCategoryRequest(question) {
  return Boolean(getCategoryBrowseIntent(question))
    && !/(\d|ابيض|بيج|ذهبي|فضي|مربع|مستطيل|دائري|white|beige|gold|silver|square|rectangular|round)/i.test(normalizeText(question));
}

function getPriceSort(question) {
  const text = normalizeText(question);
  if (/(ارخص|الارخص|الاقل سعرا|اقل سعر|cheapest|cheaper|lowest price|most affordable)/i.test(text)) return "asc";
  if (/(اغلي|الاغلي|الاعلي سعرا|اعلي سعر|most expensive|highest price|priciest)/i.test(text)) return "desc";
  return null;
}

function isSizeQuestion(question) {
  return /(مقاس|مقاسات|المقاس|حجم|احجام|size|dimension)/i.test(normalizeText(question));
}

function isMaterialQuestion(question) {
  return /(خامة|خامه|الخامة|الخامه|مصنوع|مصنوعة|ماده|الماده|امن للاكل|امن غذائ|مواد|material|made of|food grade|food safe|safe for food)/i.test(normalizeText(question));
}

function productListReply(products, english, heading) {
  const limit = 10;
  const lines = products.slice(0, limit).map((product) => {
    const details = specsText(product);
    return `${product.name} — ${formatMoney(product.price, english)}${details ? ` · ${details}` : ""} · ${stockText(product, english)}`;
  });
  if (products.length > limit) {
    lines.push(english
      ? `Showing ${limit} items. Ask about a category or product name to narrow the list.`
      : `تظهر أول ${new Intl.NumberFormat("ar-EG").format(limit)} منتجات. اسأل عن فئة أو اسم منتج لتضييق القائمة.`);
  }
  return [heading, ...lines].join("\n");
}

function categoryAnswer(question, catalog, english, category) {
  const allProducts = catalog.filter((product) => product.category === category);
  let products = isAvailableProductsQuestion(question)
    ? allProducts.filter((product) => product.available === true || product.quantity > 0)
    : allProducts;
  if (!products.length) {
    if (!allProducts.length) return null;
    return { type: "answer", text: english
      ? "I can’t confirm any currently available items in this category from live stock data. Ask about a product name and I’ll check its status."
      : "لا أستطيع تأكيد توفر منتجات من هذه الفئة حاليًا حسب بيانات المخزون المباشرة. اكتب اسم منتج معين لأتحقق من حالته." };
  }

  const labels = english
    ? { boxes: "Cake boxes", boards: "Cake boards", cupcakes: "Cupcake packaging", packaging: "Packaging" }
    : { boxes: "علب الكيك", boards: "قواعد الكيك", cupcakes: "تغليف الكب كيك", packaging: "مستلزمات التغليف" };
  const priceSort = getPriceSort(question);
  if (priceSort) {
    products = [...products].sort((left, right) => priceSort === "asc" ? left.price - right.price : right.price - left.price);
    selectedProductId = products[0].id;
    const label = priceSort === "asc"
      ? (english ? "Lowest-priced in this category:" : "الأقل سعرًا في هذه الفئة:")
      : (english ? "Highest-priced in this category:" : "الأعلى سعرًا في هذه الفئة:");
    return { type: "answer", text: `${label}\n${productSummary(products[0], english)}` };
  }

  selectedProductId = null;
  return { type: "answer", text: productListReply(products, english, `${labels[category]} — ${english ? "current catalog" : "الموجودة حاليًا"}:`) };
}

function getInquiryProductName(question) {
  let name = String(question || "").trim();
  name = name.replace(/^(?:(?:do you have|do you sell|is there|can i get|can i buy|i need|i want|looking for|find me)\s+)/i, "");
  name = name.replace(/^(?:a|an|the)\s+/i, "");
  name = name.replace(/^(?:(?:هل\s*)?(?:عندكم|لديكم|يتوفر|متوفر|موجود|يوجد|فيه|ممكن\s+توفروا|اريد|عايز|عاوزه|عاوز|محتاج|محتاجه|ابغى)\s*)/i, "");
  name = name.replace(/[؟?!.,،]+$/g, "").trim();
  return name || String(question || "").trim();
}

function isExplicitProductRequest(question) {
  return /^(?:(?:do you have|do you sell|is there|can i get|can i buy|i need|i want|looking for|find me)\b|(?:هل\s*)?(?:عندكم|لديكم|يتوفر|موجود|يوجد|فيه|ممكن\s+توفروا|اريد|عايز|عاوزه|عاوز|محتاج|محتاجه|ابغى)\b)/i.test(normalizeText(question));
}

function isAffirmative(text) {
  return /^(نعم|ايوه|اه|تمام|ماشي|yes|y|sure|ok|okay|please|سجل|سجله|سجلي|اعاده|اعادة|retry)(\s+(please|من فضلك|لو سمحت))?$/i.test(normalizeText(text));
}

function isNegative(text) {
  return /^(لا|مش|no|n|not really)(\s+(شكرا|thanks|thank you))?$/i.test(normalizeText(text));
}

async function submitProductInquiry(productName) {
  if (!supabaseClient) return { ok: false, status: 0 };
  try {
    const { error } = await supabaseClient.functions.invoke("create-product-inquiry", {
      body: { product_name: productName, description: null, website: "" },
    });
    if (error) return { ok: false, status: Number(error.context?.status) || 0 };
    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 0 };
  }
}

function inquirySaveReply(productName, english = false) {
  return english
    ? `“${productName}” is not in our current product list. I’ve saved your request in our inquiries so the team can review it.`
    : `المنتج «${productName}» غير موجود ضمن منتجاتنا الحالية، وقد سجلت طلبك في قسم الاستفسارات ليراجعه الفريق.`;
}

function inquiryFailureReply(status, english = false) {
  if (status === 429) {
    return english
      ? "I couldn’t save this request because too many inquiries were sent recently. Please wait a little and try again."
      : "تعذر تسجيل الطلب بسبب كثرة الاستفسارات مؤخرًا. انتظر قليلًا ثم حاول مرة أخرى.";
  }
  if (status === 503) {
    return english
      ? "The inquiries service is temporarily unavailable, so your request was not saved. Please try again later using the product inquiry form."
      : "خدمة الاستفسارات غير متاحة مؤقتًا، لذلك لم يُحفظ طلبك. حاول لاحقًا من نموذج «أرسل استفسارك» في الصفحة.";
  }
  return english
    ? "I couldn’t save your request right now. It has not been recorded; please try again later using the product inquiry form on the page."
    : "لم أتمكن من تسجيل طلبك الآن، لذلك لم يُحفظ. حاول مرة أخرى لاحقًا من نموذج «أرسل استفسارك» في الصفحة.";
}

async function saveInquiryAndReply(productName, english = false) {
  const result = await submitProductInquiry(productName);
  return {
    ok: result.ok,
    text: result.ok ? inquirySaveReply(productName, english) : inquiryFailureReply(result.status, english),
  };
}

function processProductSearchName(rawName, catalog) {
  const match = answerQuestion(rawName, catalog);
  if (match.type === "answer") {
    inquiryFlow = null;
    appendMessage("assistant", match.text);
    return;
  }

  const productName = match.type === "missing_product" ? match.productName : getInquiryProductName(rawName);
  const english = isEnglish(rawName);
  if (!productName || productName.length > 160) {
    inquiryFlow = { step: "awaiting_product_name" };
    appendMessage("assistant", english
      ? "Please enter a shorter product name (up to 160 characters)."
      : "اكتب اسم المنتج باختصار (حتى ١٦٠ حرفًا).");
    return;
  }

  const closest = getClosestProduct(productName, catalog);
  if (closest) {
    inquiryFlow = {
      step: "confirm_nearest",
      requestedName: productName,
      nearestProductId: closest.product.id,
      english,
    };
    appendChoiceMessage(
      english
        ? `I couldn’t find an exact match. Did you mean “${closest.product.name}”?`
        : `لم أجد تطابقًا مؤكدًا. هل تقصد «${closest.product.name}»؟`,
      english
        ? [{ value: "yes", label: "Yes, that one" }, { value: "no", label: "No" }]
        : [{ value: "yes", label: "نعم، هذا هو" }, { value: "no", label: "لا" }],
    );
    return;
  }

  inquiryFlow = { step: "confirm_save", requestedName: productName, english };
  appendChoiceMessage(
    english
      ? `I couldn’t find a similar listed product. Would you like me to send “${productName}” to inquiries?`
      : `لم أجد منتجًا مشابهًا في القائمة. هل تريد تسجيل «${productName}» في الاستفسارات؟`,
    english
      ? [{ value: "yes", label: "Yes, send it" }, { value: "retry", label: "Enter another name" }, { value: "cancel", label: "Cancel" }]
      : [{ value: "yes", label: "نعم، سجّله" }, { value: "retry", label: "أكتب اسمًا آخر" }, { value: "cancel", label: "إلغاء" }],
  );
}

function isCancelChoice(text) {
  return /^(إلغاء|الغاء|cancel)$/i.test(normalizeText(text));
}

async function handleInquiryChoice(choice) {
  if (inquiryFlow?.step === "confirm_nearest") {
    const flow = inquiryFlow;
    if (choice === "yes") {
      const product = cachedCatalog?.find((entry) => entry.id === flow.nearestProductId);
      inquiryFlow = null;
      if (product) {
        selectedProductId = product.id;
        appendMessage("assistant", productSummary(product, flow.english));
      } else {
        appendMessage("assistant", flow.english
          ? "I couldn’t load that product. Please search for it again."
          : "تعذر عرض المنتج الآن. ابحث عنه مرة أخرى من خيار «تبحث عن منتج؟».");
      }
      return true;
    }
    if (choice === "no") {
      inquiryFlow = { step: "confirm_save", requestedName: flow.requestedName, english: flow.english };
      appendChoiceMessage(
        flow.english
          ? `Would you like to send your requested product “${flow.requestedName}” to inquiries instead?`
          : `حسنًا. هل تريد تسجيل المنتج الذي طلبته «${flow.requestedName}» في الاستفسارات؟`,
        flow.english
          ? [{ value: "yes", label: "Yes, send it" }, { value: "retry", label: "Enter another name" }, { value: "cancel", label: "Cancel" }]
          : [{ value: "yes", label: "نعم، سجّله" }, { value: "retry", label: "أكتب اسمًا آخر" }, { value: "cancel", label: "إلغاء" }],
      );
      return true;
    }
  }

  if (inquiryFlow?.step === "confirm_save") {
    const flow = inquiryFlow;
    if (choice === "yes") {
      setSending(true);
      const typingMessage = appendMessage("assistant", flow.english ? "Sending your confirmed request…" : "جارٍ تسجيل طلبك بعد تأكيدك…", "typing");
      try {
        const result = await saveInquiryAndReply(flow.requestedName, flow.english);
        typingMessage.remove();
        if (result.ok) {
          inquiryFlow = null;
          appendMessage("assistant", result.text);
        } else {
          appendMessage("assistant", result.text);
          appendChoiceMessage(
            flow.english ? "Would you like to retry or enter another name?" : "يمكنك إعادة المحاولة أو كتابة اسم آخر.",
            flow.english
              ? [{ value: "yes", label: "Retry" }, { value: "retry", label: "Enter another name" }, { value: "cancel", label: "Cancel" }]
              : [{ value: "yes", label: "إعادة المحاولة" }, { value: "retry", label: "أكتب اسمًا آخر" }, { value: "cancel", label: "إلغاء" }],
          );
        }
      } catch {
        typingMessage.remove();
        appendMessage("assistant", inquiryFailureReply(0, flow.english));
      } finally {
        setSending(false);
        input.focus();
      }
      return true;
    }
    if (choice === "retry") {
      inquiryFlow = { step: "awaiting_product_name" };
      appendMessage("assistant", flow.english
        ? "Type another product name and I’ll check it."
        : "اكتب اسم منتج آخر وسأتحقق منه.");
      input.focus();
      return true;
    }
    if (choice === "cancel") {
      inquiryFlow = null;
      appendMessage("assistant", flow.english ? "Request cancelled." : "تم إلغاء تسجيل الطلب.");
      input.focus();
      return true;
    }
    if (choice === "no") {
      inquiryFlow = null;
      appendMessage("assistant", flow.english ? "Request cancelled." : "حسنًا، لن أسجل هذا الطلب.");
      input.focus();
      return true;
    }
  }
  return false;
}

function formatMoney(value, english = false) {
  const amount = new Intl.NumberFormat(english ? "en-EG" : "ar-EG", { maximumFractionDigits: 2 }).format(value);
  return english ? `${amount} EGP` : `${amount} ج.م`;
}

function stockText(product, english = false) {
  if (product.available === false || product.quantity === 0) {
    return english ? "Out of stock at the moment; expected to return soon." : "غير متوفر حاليًا، ومن المتوقع توفره قريبًا.";
  }
  if (product.quantity !== null) {
    return english
      ? `Available now: ${product.quantity} item(s).`
      : `المتاح حاليًا: ${new Intl.NumberFormat("ar-EG").format(product.quantity)}.`;
  }
  if (product.available === true) return english ? "Available now; exact quantity is not available." : "متوفر حاليًا، والكمية الدقيقة غير محددة.";
  return english ? "Current stock could not be confirmed." : "تعذر تأكيد حالة المخزون حاليًا.";
}

function specsText(product) {
  const values = Object.values(product.specs).filter((value) =>
    typeof value === "string" || typeof value === "number"
  );
  const details = [product.details, ...values.map(String)].filter(Boolean);
  return [...new Set(details)].join(" · ");
}

function productMaterialDetails(product) {
  const matches = Object.entries(product.specs)
    .filter(([key]) => /(material|food safe|food grade|خامة|خامه|ماده|ملامسة الطعام|امن للاكل|امن غذائ)/i.test(normalizeText(key)))
    .map(([, value]) => value)
    .filter((value) => typeof value === "string" || typeof value === "number");
  return [...new Set(matches.map(String).filter(Boolean))].join(" · ");
}

function productSummary(product, english = false) {
  const details = specsText(product);
  const lines = [
    `${product.name} — ${formatMoney(product.price, english)}`,
    details,
    stockText(product, english),
  ].filter(Boolean);
  return lines.join("\n");
}

function deliveryReply(question, english = false) {
  const normalized = normalizeText(question);
  const governorate = findGovernorate(normalized);
  if (/(خارج مصر|برا مصر|السعوديه|الرياض|جده|الامارات|دبي|الكويت|قطر|البحرين|عمان|international|outside egypt|abroad|saudi|riyadh|uae|dubai|kuwait|qatar|bahrain|oman)/i.test(normalized)) {
    return english
      ? `I can’t confirm international delivery availability or fees. Please contact Zmzm at ${CONTACT_NUMBER}.`
      : `لا أستطيع تأكيد توفر الشحن الدولي أو تكلفته. تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR} للتأكد.`;
  }
  if (governorate) {
    const fee = getShippingFee(1, governorate.name);
    return english
      ? `Delivery usually takes 2–5 days. For ${governorate.englishName}, shipping is ${formatMoney(fee, true)} on orders below ${formatMoney(FREE_SHIPPING_THRESHOLD, true)} and free from ${formatMoney(FREE_SHIPPING_THRESHOLD, true)}.`
      : `مدة التوصيل عادةً من يومين إلى خمسة أيام. الشحن إلى ${governorate.name} بقيمة ${formatMoney(fee)} للطلبات الأقل من ${formatMoney(FREE_SHIPPING_THRESHOLD)} جنيه، ومجاني للطلبات من ${formatMoney(FREE_SHIPPING_THRESHOLD)} جنيه فأكثر.`;
  }

  const fees = [
    `السويس ${formatMoney(getShippingFee(1, "السويس"))}`,
    `القاهرة والجيزة والإسماعيلية وبورسعيد ${formatMoney(getShippingFee(1, "القاهرة"))}`,
    `باقي المحافظات ${formatMoney(getShippingFee(1, "سوهاج"))}`,
  ].join("، ");
  return english
    ? `Delivery usually takes 2–5 days. Shipping is free from ${formatMoney(FREE_SHIPPING_THRESHOLD, true)}. Below that: Suez 40 EGP; Cairo, Giza, Ismailia, and Port Said 65 EGP; other governorates 85 EGP. Which governorate are you in?`
    : `مدة التوصيل ${DELIVERY_TIME_NOTE.replace("مدة التوصيل ", "").replace(/[.]$/, "").replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[digit])}. الشحن مجاني للطلبات من ٥٠٠ جنيه فأكثر. وللطلبات الأقل: ${fees}. ما المحافظة التي تريد التوصيل إليها؟`;
}

function isDeliveryQuestion(question) {
  return /(توصيل|الشحن|شحن|يوصل|توصل|التوصيل|محافظه|محافظة|delivery|shipping|deliver|ship\b)/i.test(question);
}

function isProductListQuestion(question) {
  if (isSizeCatalogQuestion(question)) return false;
  return /(قائمة المنتجات|اعرض المنتجات|عرض المنتجات|وريني المنتجات|كل المنتجات|منتجاتكم|منتجات زمزم|المنتجات المتاحه|المتاح عندكم|البضاعه|الاصناف|قائمة الاسعار|اسعار المنتجات|ايه عندكم|ماذا لديكم|انواع المنتجات|ما المنتجات|ايه المنتجات|list (your )?(products|items)|show (me )?(your )?(products|catalog|items)|what products|what do you have|product catalog|catalog|available products|in stock products|show me everything)/i.test(normalizeText(question));
}

function isAvailableProductsQuestion(question) {
  return /(المنتجات المتاحه|المتاح عندكم|ايه المتوفر|المتوفر حاليا|متوفره|متوفر|متاحه|متاح|in stock|available products|currently available|what do you have available|available)/i.test(normalizeText(question));
}

function answerStaticQuestion(question) {
  const english = isEnglish(question);
  const text = normalizeText(question);

  if (isDeliveryQuestion(question) || isGovernorateOnlyReply(question)) {
    return deliveryReply(question, english);
  }
  if (/(رقم|اتواصل|تواصل|اتصل|واتساب|هاتف|phone|contact|whatsapp|call)/i.test(text)) {
    return english
      ? `You can reach Zmzm at ${CONTACT_NUMBER}.`
      : `يمكنك التواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR}.`;
  }
  if (/(موقع|عنوان|مكانكم|مكان المتجر|فين المحل|فرع|فروع|محل|where are you|store location|address|shop|branch)/i.test(text)) {
    return english
      ? `Zmzm is listed in Suez, Egypt, but I don’t have a detailed street address. Please contact us at ${CONTACT_NUMBER}.`
      : `الموقع يذكر أن زمزم في السويس، مصر، لكن لا يتوفر لدي عنوان تفصيلي. تواصل معنا على الرقم ${CONTACT_NUMBER_AR} لمعرفة العنوان.`;
  }
  if (/(تتبع|اتابع|حاله طلبي|حالة طلبي|طلبي فين|order status|track my order|where is my order)/i.test(text)) {
    return english
      ? `I can’t access individual order records in this chat. Please contact Zmzm at ${CONTACT_NUMBER}.`
      : `لا أستطيع الاطلاع على بيانات الطلبات الفردية من خلال هذه المحادثة. لمتابعة طلبك، تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR}.`;
  }
  if (isMaterialQuestion(text) && !hasProductCue(text)) {
    return english
      ? "Zmzm’s site says it selects sturdy, food-safe materials. I can’t verify a specific material or certification for each item from the product data, so tell me the product name or contact us to confirm."
      : "يذكر موقع زمزم اختيار خامات قوية وآمنة غذائيًا، لكن لا أستطيع تأكيد خامة أو شهادة سلامة لكل منتج من بياناته الحالية. اكتب اسم المنتج لأراجع مواصفاته أو تواصل معنا للتأكيد.";
  }
  if (/(اطلب|الطلب|اطلبه|اشتري|شراء|السله|سله|checkout|how do i order|how to order|place an order)/i.test(text)) {
    return english
      ? "Add the products you want to your cart, then choose Checkout and enter your delivery details."
      : "أضف المنتجات التي تريدها إلى السلة، ثم اختر «إتمام الطلب» وأدخل بيانات التوصيل.";
  }
  if (/(استرجاع|استبدال|ارجاع|إرجاع|استرداد|مرتجع|return|refund|exchange|cancel)/i.test(text)) {
    return english
      ? `I don't have confirmed return or refund policy details. Please contact Zmzm at ${CONTACT_NUMBER}.`
      : `لا تتوفر لدي تفاصيل مؤكدة عن سياسة الاسترجاع أو الاستبدال. تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR} لمعرفة التفاصيل.`;
  }
  if (/(الدفع|ادفع|طرق الدفع|payment|pay|cash|visa)/i.test(text)) {
    return english
      ? `For payment options, please contact Zmzm at ${CONTACT_NUMBER}. Never send payment card details in this chat.`
      : `لمعرفة طرق الدفع المتاحة، تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR}. لا ترسل بيانات بطاقتك في المحادثة.`;
  }
  if (/(افضل|الأفضل|احسن|أحسن|انصح|ترشح|recommend|best|popular|most popular|best seller)/i.test(text)) {
    return english
      ? "I can compare listed products by size, price, and confirmed stock, but I don’t have verified customer ratings or a best-seller ranking. Tell me what size or use you need and I’ll narrow down the catalog."
      : "أقدر أقارن المنتجات المسجلة حسب المقاس والسعر والتوفر المؤكد، لكن لا تتوفر لدي تقييمات عملاء موثقة أو ترتيب للأكثر مبيعًا. أخبرني بالمقاس أو الاستخدام المطلوب لأضيّق لك الاختيارات.";
  }
  if (/(مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|hello|hi|hey)/i.test(text) && text.length < 36) {
    return english
      ? "Hello! I can help with products, sizes, prices, stock, delivery, and placing an order."
      : "أهلًا بك! أقدر أساعدك في المنتجات والمقاسات والأسعار والتوفر والتوصيل وطريقة الطلب.";
  }
  if (/(مين انت|من انت|مساعد زمزم|what can you do|who are you|what do you help with)/i.test(text)) {
    return english
      ? "I’m Zmzm’s store assistant. I can check listed products, prices, sizes, and stock, explain delivery fees and ordering, and record a product request after your confirmation."
      : "أنا مساعد زمزم. أتحقق من المنتجات المسجلة وأسعارها ومقاساتها وتوفرها، وأوضح رسوم التوصيل وطريقة الطلب، ويمكنني تسجيل طلب منتج بعد تأكيدك.";
  }
  return null;
}

function answerQuestion(question, catalog) {
  const english = isEnglish(question);
  if (isProductListQuestion(question)) {
    if (!catalog.length) return { type: "answer", text: english ? "There are no listed products right now." : "لا توجد منتجات معروضة حاليًا." };
    selectedProductId = null;
    let products = catalog;
    if (isAvailableProductsQuestion(question)) {
      products = catalog.filter((product) => product.available === true || product.quantity > 0);
      if (!products.length) {
        return { type: "answer", text: english
          ? "I can’t confirm any currently available items from the live stock data. Ask about a product name and I’ll check its status."
          : "لا أستطيع تأكيد توفر منتجات حاليًا من بيانات المخزون المباشرة. اكتب اسم منتج معين لأتحقق من حالته." };
      }
    }
    const heading = english ? "Here are some products from the current catalog:" : "هذه بعض المنتجات الموجودة في الكتالوج الحالي:";
    return { type: "answer", text: productListReply(products, english, heading) };
  }

  if (isSizeCatalogQuestion(question)) {
    if (!catalog.length) return { type: "answer", text: english ? "There are no listed products right now." : "لا توجد منتجات معروضة حاليًا." };
    selectedProductId = null;
    const heading = english ? "Here are the sizes and specifications listed for our products:" : "هذه المقاسات والمواصفات المسجلة للمنتجات:";
    const products = isAvailableProductsQuestion(question)
      ? catalog.filter((product) => product.available === true || product.quantity > 0)
      : catalog;
    if (!products.length && isAvailableProductsQuestion(question)) {
      return { type: "answer", text: english
        ? "I can’t confirm any currently available sizes from live stock data. Ask about a product name and I’ll check it."
        : "لا أستطيع تأكيد المقاسات المتاحة حاليًا من بيانات المخزون المباشرة. اكتب اسم منتج معين لأتحقق منه." };
    }
    const lines = products.slice(0, 10).map((product) => {
      const details = specsText(product);
      return `${product.name}: ${details || (english ? "No size details are listed." : "لا توجد تفاصيل مقاس مسجلة.")}`;
    });
    if (products.length > 10) lines.push(english ? "Ask about a category or product name to narrow the list." : "اسأل عن فئة أو اسم منتج لتضييق القائمة.");
    return { type: "answer", text: [heading, ...lines].join("\n") };
  }

  const broadCategory = getCategoryBrowseIntent(question);
  if (broadCategory && isBroadCategoryRequest(question)) {
    const result = categoryAnswer(question, catalog, english, broadCategory);
    if (result) return result;
  }

  const matches = getReliableProductMatches(question, catalog);
  if (matches.length) {
    const priceSort = getPriceSort(question);
    if (priceSort && matches.length > 1) {
      const ranked = [...matches].sort((left, right) => priceSort === "asc"
        ? left.product.price - right.product.price
        : right.product.price - left.product.price);
      selectedProductId = ranked[0].product.id;
      const label = priceSort === "asc"
        ? (english ? "The lowest-priced matching product is:" : "أقل منتج مطابق في السعر هو:")
        : (english ? "The highest-priced matching product is:" : "أعلى منتج مطابق في السعر هو:");
      return { type: "answer", text: `${label}\n${productSummary(ranked[0].product, english)}` };
    }
    if (matches.length === 1 || matches[0].score - matches[1].score >= 4) {
      selectedProductId = matches[0].product.id;
      if (isMaterialQuestion(question)) {
        const materialDetails = productMaterialDetails(matches[0].product);
        return { type: "answer", text: materialDetails
          ? `${matches[0].product.name}: ${materialDetails}`
          : (english
            ? `The catalog doesn’t list the material or food-safety details for ${matches[0].product.name}. Please contact Zmzm at ${CONTACT_NUMBER} to confirm.`
            : `لا يذكر الكتالوج خامة ${matches[0].product.name} أو مدى ملاءمتها لملامسة الطعام. تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR} للتأكد.`) };
      }
      if (isSizeQuestion(question) && !specsText(matches[0].product)) {
        return { type: "answer", text: english
          ? `The catalog doesn’t list size details for ${matches[0].product.name}. Please contact Zmzm at ${CONTACT_NUMBER} to confirm.`
          : `لا توجد تفاصيل مقاس مسجلة لـ ${matches[0].product.name}. تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR} للتأكد.` };
      }
      return { type: "answer", text: productSummary(matches[0].product, english) };
    }
    selectedProductId = null;
    const heading = english ? "I found a few matching products. Which one do you mean?" : "وجدت أكثر من منتج قريب من وصفك. أيّها تقصد؟";
    return { type: "answer", text: [heading, ...matches.slice(0, 4).map(({ product }) =>
      `${product.name} — ${formatMoney(product.price, english)} · ${stockText(product, english)}`
    )].join("\n") };
  }

  const category = getCategoryBrowseIntent(question);
  if (category) {
    const allCategoryProducts = catalog.filter((product) => product.category === category);
    let categoryProducts = allCategoryProducts;
    if (isAvailableProductsQuestion(question)) {
      categoryProducts = categoryProducts.filter((product) => product.available === true || product.quantity > 0);
    }
    if (isAvailableProductsQuestion(question) && allCategoryProducts.length && !categoryProducts.length) {
      return { type: "answer", text: english
        ? `I can’t confirm any currently available items in this category from the live stock data. Ask about a product name and I’ll check its status.`
        : `لا أستطيع تأكيد توفر منتجات من هذه الفئة حاليًا حسب بيانات المخزون المباشرة. اكتب اسم منتج معين لأتحقق من حالته.` };
    }
    if (categoryProducts.length) {
      selectedProductId = null;
      const labels = english
        ? { boxes: "Cake boxes", boards: "Cake boards", cupcakes: "Cupcake packaging", packaging: "Packaging" }
        : { boxes: "علب الكيك", boards: "قواعد الكيك", cupcakes: "تغليف الكب كيك", packaging: "مستلزمات التغليف" };
      const priceSort = getPriceSort(question);
      const sorted = priceSort
        ? [...categoryProducts].sort((left, right) => priceSort === "asc" ? left.price - right.price : right.price - left.price)
        : categoryProducts;
      if (priceSort) {
        selectedProductId = sorted[0].id;
        const label = priceSort === "asc"
          ? (english ? "Lowest-priced in this category:" : "الأقل سعرًا في هذه الفئة:")
          : (english ? "Highest-priced in this category:" : "الأعلى سعرًا في هذه الفئة:");
        return { type: "answer", text: `${label}\n${productSummary(sorted[0], english)}` };
      }
      return { type: "answer", text: productListReply(sorted, english, `${labels[category]} — ${english ? "current catalog" : "الموجودة حاليًا"}:`) };
    }
  }

  const priceSort = getPriceSort(question);
  if (priceSort && catalog.length) {
    const sorted = [...catalog].sort((left, right) => priceSort === "asc" ? left.price - right.price : right.price - left.price);
    selectedProductId = sorted[0].id;
    return { type: "answer", text: `${english ? "From the listed catalog:" : "من المنتجات المسجلة:"}\n${productSummary(sorted[0], english)}` };
  }

  if (selectedProductId !== null && !hasProductCue(question) && /(السعر|سعر|متاح|مخزون|الكمية|كمية|مقاس|المقاس|خامة|مصنوع|material|food safe|price|stock|available|size|quantity|specification)/i.test(normalizeText(question))) {
    const previousProduct = catalog.find((product) => product.id === selectedProductId);
    if (previousProduct) {
      if (isMaterialQuestion(question)) {
        const materialDetails = productMaterialDetails(previousProduct);
        return { type: "answer", text: materialDetails
          ? `${previousProduct.name}: ${materialDetails}`
          : (english
            ? `The catalog doesn’t list the material or food-safety details for ${previousProduct.name}. Please contact Zmzm at ${CONTACT_NUMBER}.`
            : `لا يذكر الكتالوج خامة ${previousProduct.name} أو مدى ملاءمتها لملامسة الطعام. تواصل مع زمزم على الرقم ${CONTACT_NUMBER_AR} للتأكد.`) };
      }
      return { type: "answer", text: productSummary(previousProduct, english) };
    }
  }

  const meaningfulTokens = [...new Set(tokens(question).filter((token) => !STOP_WORDS.has(token) && token.length > 1))];
  if ((hasProductCue(question) && meaningfulTokens.length >= 2)
    || (isExplicitProductRequest(question) && meaningfulTokens.length >= 1)) {
    return { type: "missing_product", productName: getInquiryProductName(question) };
  }

  return { type: "unclear" };
}

function disablePreviousChoices() {
  messagesView.querySelectorAll(".store-assistant-confirm-actions button").forEach((button) => {
    button.disabled = true;
  });
}

async function sendMessage(text, visibleText = text) {
  const cleanText = text.trim();
  if (!cleanText || isSending) return;

  setPanelOpen(true);
  suggestions.hidden = false;
  appendMessage("user", visibleText.trim() || cleanText);
  disablePreviousChoices();
  input.value = "";
  input.style.height = "auto";

  if (inquiryFlow?.step === "confirm_nearest" || inquiryFlow?.step === "confirm_save") {
    const choice = ["yes", "no", "retry", "cancel"].includes(cleanText.toLowerCase())
      ? cleanText.toLowerCase()
      : isAffirmative(cleanText) ? "yes" : isNegative(cleanText) ? "no" : isCancelChoice(cleanText) ? "cancel" : null;
    if (choice && await handleInquiryChoice(choice)) {
      input.focus();
      return;
    }
    inquiryFlow = { step: "awaiting_product_name" };
  }

  if (inquiryFlow?.step === "awaiting_product_name") {
    if (isCancelChoice(cleanText) || isNegative(cleanText)) {
      inquiryFlow = null;
      appendMessage("assistant", isEnglish(cleanText)
        ? "Product search cancelled. You can choose “Searching for a product?” whenever you want to try again."
        : "تم إلغاء البحث. يمكنك اختيار «تبحث عن منتج؟» للبدء من جديد.");
      input.focus();
      return;
    }
    if (isAffirmative(cleanText)) {
      appendMessage("assistant", isEnglish(cleanText)
        ? "Please type the product name you’re looking for."
        : "اكتب اسم المنتج الذي تبحث عنه.");
      input.focus();
      return;
    }
  } else {
    const staticAnswer = answerStaticQuestion(cleanText);
    if (staticAnswer) {
      appendMessage("assistant", staticAnswer);
      input.focus();
      return;
    }
  }

  setSending(true);
  const typingMessage = appendMessage("assistant", "جاري البحث في المنتجات…", "typing");

  try {
    const catalog = await loadCatalog();
    typingMessage.remove();

    if (inquiryFlow?.step === "awaiting_product_name") {
      processProductSearchName(cleanText, catalog);
    } else {
      const result = answerQuestion(cleanText, catalog);
      if (result.type === "missing_product") {
        processProductSearchName(result.productName, catalog);
      } else if (result.type === "unclear") {
        appendMessage("assistant", isEnglish(cleanText)
          ? "I’m Zmzm’s store assistant, so I can help with listed cake boxes, boards, packaging, prices, sizes, stock, delivery, and ordering. If you mean a particular product, click “تبحث عن منتج؟” and enter its name; I’ll check the catalog and ask before recording an inquiry."
          : "أنا مساعد متجر زمزم، وأساعدك في علب الكيك والقواعد ومستلزمات التغليف المسجلة وأسعارها ومقاساتها وتوفرها والتوصيل والطلب. لو تقصد منتجًا معينًا، اضغط «تبحث عن منتج؟» واكتب اسمه؛ سأراجع الكتالوج وأطلب تأكيدك قبل تسجيل أي استفسار.");
      } else {
        appendMessage("assistant", result.text);
      }
    }
  } catch {
    typingMessage.remove();
    appendMessage("assistant", isEnglish(cleanText)
      ? `I can’t reach the store information right now. Please try again shortly or contact us at ${CONTACT_NUMBER}.`
      : `تعذر الوصول إلى معلومات المتجر الآن. حاول مرة أخرى بعد قليل أو تواصل معنا على الرقم ${CONTACT_NUMBER_AR}.`);
  } finally {
    setSending(false);
    input.focus();
  }
}

function beginProductSearch() {
  if (isSending) return;
  disablePreviousChoices();
  startProductSearch();
}

toggle.addEventListener("click", () => setPanelOpen(panel.hidden));
closeButton.addEventListener("click", () => setPanelOpen(false));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.assistantAction === "search-product") {
    beginProductSearch();
    return;
  }
  inquiryFlow = null;
  void sendMessage(button.textContent || "");
});

messagesView.addEventListener("click", (event) => {
  const button = event.target.closest("[data-assistant-choice]");
  if (button && !button.disabled) {
    void sendMessage(button.dataset.assistantChoice || "", button.textContent || "");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) setPanelOpen(false);
});
