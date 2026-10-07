import { supabaseClient } from "../../supabase-config.js";
import { normalizeDigits } from "./safe-dom.js";
import { DELIVERY_TIME_NOTE, getShippingFee } from "./shipping.js";

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
  "المنتج", "منتجات", "المنتجات", "الكمية", "كمية", "مخزون", "المخزون", "علي", "عايزه", "عاوزه",
  "السلام", "عليكم", "مرحبا", "اهلا", "لو", "سمحت", "بعد", "من", "فضلك", "عايزين", "مع",
]);

const GOVERNORATES = [
  { name: "السويس", englishName: "Suez", aliases: ["السويس", "سويس", "suez"] },
  { name: "القاهرة", englishName: "Cairo", aliases: ["القاهرة", "القاهره", "cairo"] },
  { name: "الجيزة", englishName: "Giza", aliases: ["الجيزة", "الجيزه", "giza"] },
  { name: "الإسماعيلية", englishName: "Ismailia", aliases: ["الإسماعيلية", "الاسماعيلية", "اسماعيلية", "اسماعيليه", "ismailia", "ismailiya"] },
  { name: "بورسعيد", englishName: "Port Said", aliases: ["بورسعيد", "بور سعيد", "port said", "portsaid"] },
  { name: "الإسكندرية", englishName: "Alexandria", aliases: ["الإسكندرية", "الاسكندرية", "اسكندرية", "اسكندريه", "alexandria", "alex"] },
];

const CONTACT_NUMBER = "+20 102 431 1053";
let isSending = false;
let cachedCatalog = null;
let catalogLoadedAt = 0;
let selectedProductId = null;

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
  return /[a-z]/i.test(text);
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

function setPanelOpen(isOpen) {
  panel.hidden = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) input.focus();
  else toggle.focus({ preventScroll: true });
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
  const governorate = GOVERNORATES.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(normalizeText(alias)))
  );
  if (governorate) {
    const fee = getShippingFee(1, governorate.name);
    return english
      ? `Delivery usually takes 2–5 days. For ${governorate.englishName}, shipping is ${formatMoney(fee, true)} on orders below 500 EGP and free from 500 EGP.`
      : `مدة التوصيل عادةً من يومين إلى خمسة أيام. الشحن إلى ${governorate.name} بقيمة ${formatMoney(fee)} للطلبات الأقل من ٥٠٠ جنيه، ومجاني للطلبات من ٥٠٠ جنيه فأكثر.`;
  }

  const fees = [
    `السويس ${formatMoney(getShippingFee(1, "السويس"))}`,
    `القاهرة والجيزة والإسماعيلية وبورسعيد ${formatMoney(65)}`,
    `باقي المحافظات ${formatMoney(85)}`,
  ].join("، ");
  return english
    ? `Delivery usually takes 2–5 days. Shipping is free from 500 EGP. Below that: Suez 40 EGP; Cairo, Giza, Ismailia, and Port Said 65 EGP; other governorates 85 EGP. Which governorate are you in?`
    : `مدة التوصيل ${DELIVERY_TIME_NOTE.replace("مدة التوصيل ", "")}. الشحن مجاني للطلبات من ٥٠٠ جنيه فأكثر. وللطلبات الأقل: ${fees}. ما المحافظة التي تريد التوصيل إليها؟`;
}

function isDeliveryQuestion(question) {
  return /(توصيل|الشحن|شحن|يوصل|التوصيل|محافظه|محافظة|delivery|shipping|deliver)/i.test(question);
}

function isProductListQuestion(question) {
  return /(المنتجات|منتجاتكم|المنتج|مقاسات|المقاسات|المتاح|الموجود|عندكم|اعرض|وريني|قائمة المنتجات|البضاعة|الاصناف|الاسعار|قائمة الاسعار|products|catalog|available|in stock|what do you have|show me)/i.test(question);
}

function answerStaticQuestion(question) {
  const english = isEnglish(question);
  const text = normalizeText(question);

  if (isDeliveryQuestion(question)) return deliveryReply(question, english);
  if (/(رقم|اتواصل|تواصل|اتصل|واتساب|هاتف|phone|contact|whatsapp|call)/i.test(text)) {
    return english
      ? `You can reach Zmzm at ${CONTACT_NUMBER}.`
      : `يمكنك التواصل مع زمزم على الرقم ${CONTACT_NUMBER}.`;
  }
  if (/(اطلب|الطلب|اطلبه|اشتري|شراء|السله|سله|checkout|how do i order|how to order|place an order)/i.test(text)) {
    return english
      ? "Add the products you want to your cart, then choose Checkout and enter your delivery details."
      : "أضف المنتجات التي تريدها إلى السلة، ثم اختر «إتمام الطلب» وأدخل بيانات التوصيل.";
  }
  if (/(استرجاع|استبدال|ارجاع|إرجاع|استرداد|مرتجع|return|refund|exchange|cancel)/i.test(text)) {
    return english
      ? `I don't have confirmed return or refund policy details. Please contact Zmzm at ${CONTACT_NUMBER}.`
      : `لا تتوفر لدي تفاصيل مؤكدة عن سياسة الاسترجاع أو الاستبدال. تواصل مع زمزم على الرقم ${CONTACT_NUMBER} لمعرفة التفاصيل.`;
  }
  if (/(الدفع|ادفع|طرق الدفع|payment|pay|cash|visa)/i.test(text)) {
    return english
      ? `For payment options, please contact Zmzm at ${CONTACT_NUMBER}. Never send payment card details in this chat.`
      : `لمعرفة طرق الدفع المتاحة، تواصل مع زمزم على الرقم ${CONTACT_NUMBER}. لا ترسل بيانات بطاقتك في المحادثة.`;
  }
  if (/(مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|hello|hi|hey)/i.test(text) && text.length < 36) {
    return english
      ? "Hello! I can help with products, sizes, prices, stock, delivery, and placing an order."
      : "أهلًا بك! أقدر أساعدك في المنتجات والمقاسات والأسعار والتوفر والتوصيل وطريقة الطلب.";
  }
  return null;
}

function answerQuestion(question, catalog) {
  const english = isEnglish(question);
  const matches = getProductMatches(question, catalog);
  if (matches.length) {
    if (matches.length === 1 || matches[0].score - matches[1].score >= 4) {
      selectedProductId = matches[0].product.id;
      return productSummary(matches[0].product, english);
    }
    selectedProductId = null;
    const heading = english ? "I found a few matching products. Which one do you mean?" : "وجدت أكثر من منتج قريب من وصفك. أيّها تقصد؟";
    return [heading, ...matches.slice(0, 4).map(({ product }) =>
      `${product.name} — ${formatMoney(product.price, english)} · ${stockText(product, english)}`
    )].join("\n");
  }

  if (selectedProductId !== null && /(السعر|سعر|متاح|مخزون|الكمية|كمية|مقاس|المقاس|price|stock|available|size|quantity)/i.test(normalizeText(question))) {
    const previousProduct = catalog.find((product) => product.id === selectedProductId);
    if (previousProduct) return productSummary(previousProduct, english);
  }

  if (isProductListQuestion(question)) {
    if (!catalog.length) return english ? "There are no listed products right now." : "لا توجد منتجات معروضة حاليًا.";
    const heading = english ? "Here are some products from the current catalog:" : "هذه بعض المنتجات الموجودة في الكتالوج الحالي:";
    return [heading, ...catalog.slice(0, 8).map((product) =>
      `${product.name} — ${formatMoney(product.price, english)} · ${stockText(product, english)}`
    )].join("\n");
  }

  return english
    ? `I can help with products, sizes, current prices and stock, delivery, and how to order. For other questions, contact Zmzm at ${CONTACT_NUMBER}.`
    : `أقدر أساعدك في المنتجات ومقاساتها وأسعارها وتوفرها والتوصيل وطريقة الطلب. اكتب اسم المنتج أو سؤالك عن التوصيل، وللاستفسارات الأخرى تواصل مع زمزم على ${CONTACT_NUMBER}.`;
}

async function sendMessage(text) {
  const cleanText = text.trim();
  if (!cleanText || isSending) return;

  setPanelOpen(true);
  suggestions.hidden = true;
  appendMessage("user", cleanText);
  input.value = "";
  input.style.height = "auto";

  const staticAnswer = answerStaticQuestion(cleanText);
  if (staticAnswer) {
    appendMessage("assistant", staticAnswer);
    input.focus();
    return;
  }

  setSending(true);
  const typingMessage = appendMessage("assistant", "جاري البحث في المنتجات…", "typing");

  try {
    const catalog = await loadCatalog();
    typingMessage.remove();
    appendMessage("assistant", answerQuestion(cleanText, catalog));
  } catch {
    typingMessage.remove();
    appendMessage("assistant", "تعذر الوصول إلى معلومات المتجر الآن. حاول مرة أخرى بعد قليل أو تواصل معنا على 01024311053.");
  } finally {
    setSending(false);
    input.focus();
  }
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
  if (button) void sendMessage(button.textContent || "");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) setPanelOpen(false);
});
