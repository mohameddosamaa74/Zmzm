import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("storefront no longer renders wishlist or quick-view controls", async () => {
  const [html, script] = await Promise.all([read("index.html"), read("script.js")]);
  assert.doesNotMatch(`${html}\n${script}`, /wishlist|quick[- ]view|data-favorite/i);
});

test("out-of-stock cards are dimmed and the cart cannot exceed available quantity", async () => {
  const [script, styles] = await Promise.all([read("script.js"), read("src/css/product-image.css")]);
  assert.match(script, /is-out-of-stock/);
  assert.match(script, /product\.quantity\s*>=\s*product\.availableQuantity|item\.quantity\s*>=\s*item\.product\.availableQuantity/);
  assert.match(script, /canAddProduct/);
  assert.match(styles, /\.is-out-of-stock/);
});

test("product search matches every normalized query term", async () => {
  const script = await read("script.js");
  assert.match(script, /function normalizeSearchText\(value\)/);
  assert.match(script, /normalizeDigits\(value\)/);
  assert.match(script, /replace\(\/\[أإآٱ\]\/g, "ا"\)/);
  assert.match(script, /queryTerms\.every\(\(term\) => searchableText\.includes\(term\)\)/);
});

test("checkout refreshes stock and blocks unavailable or over-limit cart items", async () => {
  const checkout = await read("src/js/checkout.js");
  assert.match(checkout, /get_public_product_availability/);
  assert.match(checkout, /quantity\s*>\s*product\.availableQuantity/);
  assert.match(checkout, /submitButton\.disabled\s*=.*hasUnavailableItems/s);
});

test("admin includes warehouse and accounts dashboards with monthly summaries", async () => {
  const [html, admin] = await Promise.all([read("admin.html"), read("src/js/admin.js")]);
  for (const id of ["inventory", "inventoryAvailableUnits", "inventoryReservedUnits", "inventoryMonthSummary", "accounts", "accountsIncomeMonth", "accountsExpensesMonth", "accountsNetMonth", "purchaseCost", "productUnitProfitPreview", "productProfitTableBody", "accountsProductProfitTotal"]) {
    assert.match(html, new RegExp(`id=[\"']${id}[\"']`), `missing admin UI element ${id}`);
  }
  assert.match(admin, /get_inventory_month_summary/);
  assert.match(admin, /get_account_month_summary/);
  assert.match(admin, /salesReturns/);
  assert.match(admin, /income\s*-\s*salesReturns\s*-\s*expenses/);
  assert.match(admin, /get_product_profit_summary/);
  assert.match(admin, /price\s*-\s*product\.purchaseCost/);
});

test("admin login requires the server-issued admin role and signs non-admin users out", async () => {
  const admin = await read("src/js/admin.js");
  assert.match(admin, /signInWithPassword/);
  assert.match(admin, /data\.user\?\.app_metadata\?\.role\s*!==\s*["']admin["']/);
  assert.match(admin, /await supabaseClient\.auth\.signOut\(\)/);
  assert.match(admin, /auth\.getUser\(\)/);
});

test("database protects order creation and admin-only inventory/account data", async () => {
  const [orders, security] = await Promise.all([
    read("database/orders-migration.sql"),
    read("database/order-security-migration.sql"),
  ]);
  const inventory = await read("database/admin-inventory-accounts-migration.sql");
  assert.match(orders, /auth\.jwt\(\)\s*->\s*'app_metadata'.*role.*admin/s);
  assert.match(security, /revoke insert on public\.orders from public, anon, authenticated/i);
  assert.match(security, /grant execute on function public\.create_order_secure\([\s\S]*?\) to service_role/i);
  assert.match(inventory, /auth\.jwt\(\)\s*->\s*'app_metadata'.*role.*admin/s);
  assert.match(inventory, /revoke all on table private\.order_inventory_reservations from public, anon, authenticated/i);
});

test("delivered income uses products subtotal and historical backfill uses original order date", async () => {
  const migration = await read("database/delivered-orders-accounting-migration.sql");
  assert.match(migration, /new\.subtotal/);
  assert.match(migration, /orders\.subtotal/);
  assert.match(migration, /orders\.created_at at time zone 'Africa\/Cairo'/);
  assert.match(migration, /not exists\s*\([\s\S]*existing_entry\.order_id = orders\.id[\s\S]*entry_type = 'income'/i);
  assert.match(migration, /create unique index if not exists/);
});

test("delivered orders expose partial returns and refunds remain linked to order and stock", async () => {
  const [adminHtml, admin, migration, accountingMigration] = await Promise.all([
    read("admin.html"),
    read("src/js/admin.js"),
    read("database/order-reservation-returns-migration.sql"),
    read("database/sales-returns-accounting-migration.sql"),
  ]);
  assert.match(adminHtml, /id="orderReturnDialog"/);
  assert.match(adminHtml, /id="accountsReturnsMonth"/);
  assert.match(admin, /data-return-quantity/);
  assert.match(admin, /record_order_return/);
  assert.match(admin, /order_return_items/);
  assert.match(admin, /order-return-badge/);
  assert.match(admin, /مرتجع جزئي/);
  assert.match(admin, /مرتجع كامل/);
  assert.match(migration, /order_returns/);
  assert.match(migration, /ORDER_RETURN_QUANTITY_EXCEEDED/);
  assert.match(migration, /order_return_refund/);
  assert.match(migration, /movement_type, quantity_delta,[\s\S]*'return_damaged'/);
  assert.match(accountingMigration, /entry_type in \('income', 'expense', 'sales_return'\)/);
  assert.match(accountingMigration, /sales_returns_total/);
  assert.match(accountingMigration, /category = 'sales_return'/);
});

test("checkout reservations release on cancellation and no unlinked return movement is allowed", async () => {
  const migration = await read("database/order-reservation-returns-migration.sql");
  assert.match(migration, /reserve_order_inventory_on_insert/);
  assert.match(migration, /old\.status in \('pending', 'confirmed', 'processing'\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_movement_type not in \('opening', 'received', 'issued', 'damaged', 'count'\)/);
});

test("purchase costs stay admin-only and checkout snapshots cost for profit reporting", async () => {
  const migration = await read("database/product-cost-profit-migration.sql");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /product_costs_admin_select/);
  assert.match(migration, /snapshot_product_costs_on_order_insert/);
  assert.match(migration, /get_product_profit_summary/);
  assert.match(migration, /disposition = 'restock'/);
  assert.match(migration, /line\.value - 'unit_cost'/);
});

test("product inquiries are submitted through a rate-limited server function and reviewed by admins", async () => {
  const [home, inquiryClient, edgeFunction, adminHtml, admin, migration] = await Promise.all([
    read("index.html"),
    read("src/js/product-inquiry.js"),
    read("supabase/functions/create-product-inquiry/index.ts"),
    read("admin.html"),
    read("src/js/admin.js"),
    read("database/product-inquiries-analytics-migration.sql"),
  ]);
  assert.match(home, /id="openProductInquiry"/);
  assert.match(home, /id="inquiryProductName"[^>]*required/);
  assert.match(home, /id="inquiryDescription"[^>]*maxlength="1200"/);
  assert.doesNotMatch(home.match(/<textarea id="inquiryDescription"[^>]*>/)?.[0] || "", /required/);
  assert.match(inquiryClient, /functions\.invoke\("create-product-inquiry"/);
  assert.doesNotMatch(inquiryClient, /from\("product_inquiries"\)\.insert/);
  assert.match(edgeFunction, /cf-connecting-ip/);
  assert.match(edgeFunction, /INQUIRY_RATE_LIMITED/);
  assert.match(migration, /revoke all on public\.product_inquiries from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.submit_product_inquiry\(text, text, text\) to service_role/i);
  assert.match(migration, /product_inquiries_admin_select[\s\S]*app_metadata[\s\S]*role[\s\S]*admin/i);
  assert.match(adminHtml, /id="inquiries"/);
  assert.match(adminHtml, /id="inquiryDetailsDialog"/);
  assert.match(admin, /product_inquiries[\s\S]*\.update\(\{ status:/);
});

test("business analytics aggregate sales, profit, inventory, inquiries, and private customer phone numbers", async () => {
  const [adminHtml, admin, migration] = await Promise.all([
    read("admin.html"),
    read("src/js/admin.js"),
    read("database/product-inquiries-analytics-migration.sql"),
  ]);
  assert.match(adminHtml, /id="analytics"/);
  for (const id of ["analyticsRange", "analyticsGrossProfit", "analyticsCustomersBody", "analyticsProductsBody", "analyticsInquiriesBody", "analyticsOutOfStock"]) {
    assert.match(adminHtml, new RegExp(`id=["']${id}["']`), `missing analytics UI element ${id}`);
  }
  assert.match(admin, /rpc\("get_business_analytics"/);
  assert.match(admin, /customer\.phone/);
  assert.match(migration, /ANALYTICS_NOT_AUTHORIZED/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /'gross_profit'/);
  assert.match(migration, /'available_now'/);
  assert.match(migration, /'top_products'/);
  assert.match(migration, /'repeat_customers'/);
});
