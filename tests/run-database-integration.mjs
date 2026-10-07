import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = `zmzm_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const rolesCreated = [];

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, PGHOST: "/tmp" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code !== 0 && !allowFailure) {
        reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr || stdout}`));
      } else resolve(result);
    });
  });
}

async function psql(db, sql, { allowFailure = false } = {}) {
  return run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], { allowFailure });
}

async function ensureRole(role, attributes = "NOLOGIN") {
  const existing = await run("psql", ["-X", "-At", "-d", "postgres", "-c", `select 1 from pg_roles where rolname = '${role}'`]);
  if (existing.stdout.trim() === "1") return;
  await psql("postgres", `create role ${role} ${attributes}`);
  rolesCreated.push(role);
}

async function cleanup() {
  await run("dropdb", ["--if-exists", database], { allowFailure: true });
  for (const role of rolesCreated.reverse()) {
    await psql("postgres", `drop role if exists ${role}`, { allowFailure: true });
  }
}

let databaseReady = false;
try {
  await run("pg_isready", [], {});
  await ensureRole("anon");
  await ensureRole("authenticated");
  await ensureRole("service_role", "NOLOGIN BYPASSRLS");
  await run("createdb", [database]);
  databaseReady = true;

  const setup = await run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", "tests/database-integration.sql"]);
  process.stdout.write(setup.stdout);
  process.stderr.write(setup.stderr);

  const key1 = "40000000-0000-4000-8000-000000000001";
  const key2 = "40000000-0000-4000-8000-000000000002";
  const orderCall = (key) => `select public.create_order_secure(
    repeat('${key.slice(-1) === "1" ? "c" : "d"}', 64), '${key}',
    'Race', 'Buyer', '01012345678', 'القاهرة', 'القاهرة', 'Race address',
    '1', '1', '1', null, '[{"product_id":2,"quantity":1}]'::jsonb
  );`;
  const first = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", `begin; ${orderCall(key1)} select pg_sleep(2); commit;`], { cwd: root, env: { ...process.env, PGHOST: "/tmp" }, stdio: ["ignore", "pipe", "pipe"] });
  let firstOut = "";
  let firstErr = "";
  first.stdout.on("data", (chunk) => firstOut += chunk);
  first.stderr.on("data", (chunk) => firstErr += chunk);
  const firstDone = new Promise((resolve) => first.on("close", (code) => resolve({ code, stdout: firstOut, stderr: firstErr })));
  await delay(300);
  const second = await run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", orderCall(key2)], { allowFailure: true });
  const firstResult = await firstDone;
  const raceCount = await psql(database, "select count(*) from public.orders where idempotency_key in ('" + key1 + "','" + key2 + "')");
  const accepted = Number(raceCount.stdout.match(/\d+/)?.[0] || 0);
  process.stdout.write(`Concurrent stock-one checkout results: first=${firstResult.code === 0 ? "accepted" : "rejected"}, second=${second.code === 0 ? "accepted" : "rejected"}, saved=${accepted}\n`);

  if (firstResult.code !== 0) throw new Error(`First concurrent order failed unexpectedly: ${firstResult.stderr}`);
  const secondRejectedForStock = second.code !== 0 && second.stderr.includes("INVENTORY_INSUFFICIENT_AVAILABLE");
  if (secondRejectedForStock && accepted === 1) {
    process.stdout.write("PASS: the concurrent stock-one checkout did not accept two pending orders.\n");
  } else {
    process.stderr.write(`FAIL: expected one accepted order and one INVENTORY_INSUFFICIENT_AVAILABLE response; saved=${accepted}, second-error=${second.stderr.trim()}\n`);
    process.exitCode = 1;
  }

  if (accepted === 1) {
    await psql(database, `update public.orders set status = 'confirmed' where idempotency_key = '${key1}'`);
    const confirmedReservation = await psql(database, `
      select (select reserved from public.inventory_stock where product_id = 2) = 1
        and (select status from public.orders where idempotency_key = '${key1}') = 'confirmed'
    `);
    if (!confirmedReservation.stdout.includes("t")) {
      throw new Error("FAIL: confirming the checkout reservation changed the reserved stock count");
    }
    process.stdout.write("PASS: admin confirmation retained the checkout reservation without reserving twice.\n");
  }

  const replayKey = "50000000-0000-4000-8000-000000000001";
  const replayCall = `select public.create_order_secure(
    repeat('e', 64), '${replayKey}', 'Replay', 'Buyer', '01012345678',
    'القاهرة', 'القاهرة', 'Replay address', '1', '1', '1', null,
    '[{"product_id":1,"quantity":1}]'::jsonb
  );`;
  const replayFirst = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", `begin; ${replayCall} select pg_sleep(2); commit;`], { cwd: root, env: { ...process.env, PGHOST: "/tmp" }, stdio: ["ignore", "pipe", "pipe"] });
  let replayFirstErr = "";
  replayFirst.stderr.on("data", (chunk) => replayFirstErr += chunk);
  const replayFirstDone = new Promise((resolve) => replayFirst.on("close", (code) => resolve({ code, error: replayFirstErr })));
  await delay(300);
  const replaySecond = await run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", replayCall], { allowFailure: true });
  const replayFirstResult = await replayFirstDone;
  const replayCount = await psql(database, `select count(*) from public.orders where idempotency_key = '${replayKey}'`);
  const replaySaved = Number(replayCount.stdout.match(/\d+/)?.[0] || 0);
  if (replayFirstResult.code !== 0 || replaySecond.code !== 0 || replaySaved !== 1) {
    throw new Error(`FAIL: concurrent retry with one idempotency key did not produce exactly one order (saved=${replaySaved}) ${replayFirstResult.error}`);
  }
  process.stdout.write("PASS: simultaneous retries with the same idempotency key produced one order.\n");

  const returnOrderKey = "80000000-0000-4000-8000-000000000001";
  await psql(database, `
    select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}', false);
    select public.create_order_secure(
      repeat('f', 64), '${returnOrderKey}', 'Return', 'Buyer', '01012345678',
      'القاهرة', 'القاهرة', 'Return address', '1', '1', '1', null,
      '[{"product_id":1,"quantity":1}]'::jsonb
    );
    update public.orders set status = 'confirmed' where idempotency_key = '${returnOrderKey}';
    update public.orders set status = 'shipped' where idempotency_key = '${returnOrderKey}';
    update public.orders set status = 'delivered' where idempotency_key = '${returnOrderKey}';
  `);
  const returnOrderResult = await psql(database, `select id from public.orders where idempotency_key = '${returnOrderKey}'`);
  const returnOrderId = returnOrderResult.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!returnOrderId) throw new Error("Could not find the delivered order for the concurrent return test");

  const returnCall = (requestKey, notes) => `
    select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}', false);
    select public.record_order_return(
      '${requestKey}', '${returnOrderId}',
      '[{"product_id":1,"quantity":1,"disposition":"restock"}]'::jsonb,
      'cash', '${notes}'
    );
  `;
  const returnFirst = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", `begin; ${returnCall("90000000-0000-4000-8000-000000000001", "concurrent return one")} select pg_sleep(2); commit;`], { cwd: root, env: { ...process.env, PGHOST: "/tmp" }, stdio: ["ignore", "pipe", "pipe"] });
  let returnFirstErr = "";
  returnFirst.stderr.on("data", (chunk) => returnFirstErr += chunk);
  const returnFirstDone = new Promise((resolve) => returnFirst.on("close", (code) => resolve({ code, error: returnFirstErr })));
  await delay(300);
  const returnSecond = await run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", returnCall("90000000-0000-4000-8000-000000000002", "concurrent return two")], { allowFailure: true });
  const returnFirstResult = await returnFirstDone;
  const returnCount = await psql(database, `select count(*) from public.order_returns where order_id = '${returnOrderId}'`);
  const savedReturns = Number(returnCount.stdout.match(/\d+/)?.[0] || 0);
  if (returnFirstResult.code !== 0 || returnSecond.code === 0
    || !returnSecond.stderr.includes("ORDER_RETURN_QUANTITY_EXCEEDED") || savedReturns !== 1) {
    throw new Error(`FAIL: simultaneous returns exceeded the delivered quantity or recorded inconsistently (saved=${savedReturns}; second-error=${returnSecond.stderr.trim()}; first-error=${returnFirstResult.error})`);
  }
  process.stdout.write("PASS: simultaneous return attempts for the final unit recorded exactly one refund and restock.\n");

  const concurrentUserCount = 10;
  const concurrentOrderKeys = Array.from({ length: concurrentUserCount }, () => randomUUID());
  await psql(database, `
    select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}', false);
    select public.record_inventory_movement(3, 'received', ${concurrentUserCount}, null, '10-user local concurrency test');
  `);
  const concurrentOrderCall = (key, index) => `
    select public.create_order_secure(
      '${String(index + 1).padStart(2, "0").repeat(32)}', '${key}',
      'Concurrent', 'Buyer ${index + 1}', '01012345678',
      'القاهرة', 'القاهرة', 'Concurrency test address', '1', '1', '1', null,
      '[{"product_id":3,"quantity":1}]'::jsonb
    );
  `;
  const concurrentOrderResults = await Promise.all(concurrentOrderKeys.map((key, index) =>
    run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", concurrentOrderCall(key, index)], { allowFailure: true })
  ));
  const acceptedConcurrentOrders = concurrentOrderResults.filter((result) => result.code === 0).length;
  const savedConcurrentOrders = await psql(database, `
    select count(*) from public.orders where idempotency_key in (${concurrentOrderKeys.map((key) => `'${key}'`).join(",")});
  `);
  const savedConcurrentOrderCount = Number(savedConcurrentOrders.stdout.match(/\d+/)?.[0] || 0);
  const concurrentStock = await psql(database, "select on_hand, reserved from public.inventory_stock where product_id = 3");
  const [concurrentOnHand, concurrentReserved] = concurrentStock.stdout.match(/\d+/g)?.map(Number) || [];
  if (acceptedConcurrentOrders !== concurrentUserCount || savedConcurrentOrderCount !== concurrentUserCount
    || concurrentOnHand !== concurrentUserCount || concurrentReserved !== concurrentUserCount) {
    throw new Error(`FAIL: 10 concurrent local checkouts should each reserve one unit (accepted=${acceptedConcurrentOrders}; saved=${savedConcurrentOrderCount}; on-hand=${concurrentOnHand}; reserved=${concurrentReserved})`);
  }
  process.stdout.write("PASS: 10 simultaneous local checkout requests each created one order and reserved one unit.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (databaseReady) await cleanup();
  else {
    for (const role of rolesCreated.reverse()) await psql("postgres", `drop role if exists ${role}`, { allowFailure: true });
  }
}
