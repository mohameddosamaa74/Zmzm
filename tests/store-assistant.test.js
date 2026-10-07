import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeElement() {
  return {
    hidden: false,
    disabled: false,
    value: "",
    style: {},
    setAttribute() {},
    addEventListener() {},
    append() {},
    focus() {},
    querySelectorAll() { return []; },
    remove() {},
    scrollHeight: 0,
    scrollTop: 0,
  };
}

async function loadAssistantRules() {
  let source = await readFile(path.join(root, "src/js/store-assistant.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "");
  source += "\nglobalThis.assistantRules = { answerQuestion, answerStaticQuestion, isEnglish };";

  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement: makeElement,
    addEventListener() {},
  };
  const normalizeDigits = (value) => String(value || "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const getShippingFee = (subtotal, governorate) => {
    if (subtotal >= 500) return 0;
    if (governorate === "السويس") return 40;
    if (["القاهرة", "الجيزة", "الإسماعيلية", "بورسعيد"].includes(governorate)) return 65;
    return 85;
  };
  const context = {
    document,
    window: { matchMedia: () => ({ matches: false }) },
    normalizeDigits,
    DELIVERY_TIME_NOTE: "مدة التوصيل من 2 إلى 5 أيام.",
    FREE_SHIPPING_THRESHOLD: 500,
    getShippingFee,
  };
  vm.runInNewContext(source, context, { filename: "store-assistant.js" });
  return context.assistantRules;
}

const catalog = [
  { id: 1, name: "علبة كيك أبيض 30×30×18", category: "boxes", price: 25, details: "30×30×18", specs: {}, available: true, quantity: 3 },
  { id: 2, name: "علبة كيك أبيض 25×25×22", category: "boxes", price: 30, details: "25×25×22", specs: {}, available: false, quantity: 0 },
  { id: 3, name: "قاعدة كيك ذهبي 30×30", category: "boards", price: 15, details: "30×30", specs: {}, available: true, quantity: 5 },
];

test("assistant keeps Arabic replies for Arabic questions containing Latin size symbols", async () => {
  const assistant = await loadAssistantRules();
  assert.equal(assistant.isEnglish("سعر علبة كيك 30x30؟"), false);
  const answer = assistant.answerQuestion("علبة كيك أبيض 30x30x18", catalog);
  assert.match(answer.text, /ج\.م/);
});

test("assistant lists only confirmed in-stock products when customers ask what is available", async () => {
  const assistant = await loadAssistantRules();
  const answer = assistant.answerQuestion("ما المنتجات المتاحة؟", catalog);
  assert.equal(answer.type, "answer");
  assert.match(answer.text, /علبة كيك أبيض 30/);
  assert.doesNotMatch(answer.text, /25×25×22/);
});

test("assistant answers size questions from the catalog and ranks the cheapest category item", async () => {
  const assistant = await loadAssistantRules();
  const sizes = assistant.answerQuestion("ما المقاسات؟", catalog);
  assert.match(sizes.text, /30×30×18/);
  assert.match(sizes.text, /25×25×22/);

  const cheapest = assistant.answerQuestion("أرخص علب الكيك", catalog);
  assert.match(cheapest.text, /الأقل سعرًا في هذه الفئة/);
  assert.match(cheapest.text, /علبة كيك أبيض 30/);
});

test("assistant answers Sohag delivery from configured rates and does not invent product material", async () => {
  const assistant = await loadAssistantRules();
  const delivery = assistant.answerStaticQuestion("هل توصلون إلى سوهاج؟");
  assert.match(delivery, /سوهاج/);
  assert.match(delivery, /٨٥ ج\.م/);

  const material = assistant.answerQuestion("خامة علبة كيك أبيض 30×30×18", catalog);
  assert.match(material.text, /لا يذكر الكتالوج خامة/);
});

test("unlisted direct product requests are flagged for confirmation rather than saved silently", async () => {
  const assistant = await loadAssistantRules();
  const result = assistant.answerQuestion("Do you have gift bags?", catalog);
  assert.equal(result.type, "missing_product");
  assert.equal(result.productName, "gift bags");
});
