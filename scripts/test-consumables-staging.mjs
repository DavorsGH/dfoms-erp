/**
 * Staging: consumables CRUD + derived remaining/stock_status + tenant RLS.
 * Run: node scripts/test-consumables-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "ConsTest!2026Aa";
const tag = `CONS${Date.now().toString(36).toUpperCase()}`;

const STOCK_STATUS_OK = "OK";
const STOCK_STATUS_LOW = "Low Stock";
const STOCK_STATUS_OUT = "Out of Stock";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeRemaining(openingStock, qtyIssued, qtyUsed) {
  return Math.round((toNumber(openingStock) + toNumber(qtyIssued) - toNumber(qtyUsed)) * 100) / 100;
}

function computeStockStatus(remaining, minimumLevel) {
  if (remaining <= 0) return STOCK_STATUS_OUT;
  if (
    minimumLevel !== null &&
    minimumLevel !== undefined &&
    String(minimumLevel).trim() !== ""
  ) {
    if (remaining <= toNumber(minimumLevel)) return STOCK_STATUS_LOW;
  }
  return STOCK_STATUS_OK;
}

function deriveStockFields(input) {
  const remaining = computeRemaining(
    input.opening_stock,
    input.qty_issued,
    input.qty_used,
  );
  return {
    remaining,
    stock_status: computeStockStatus(remaining, input.minimum_level),
  };
}

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(serviceKey && anon, "Missing staging keys");

const pageSrc = readFileSync(
  resolve("app/dashboard/operations/consumables/page.tsx"),
  "utf8",
);
const clientSrc = readFileSync(
  resolve("app/dashboard/operations/consumables.tsx"),
  "utf8",
);
const navSrc = readFileSync(
  resolve("app/dashboard/operations/operations-nav.tsx"),
  "utf8",
);
assert(pageSrc.includes('from("consumables")'), "page missing table");
assert(pageSrc.includes("OperationsShell"), "page should use OperationsShell");
assert(pageSrc.includes("createClient"), "page should use server createClient");
assert(!pageSrc.includes("createAdminClient"), "page must not use admin client");
assert(clientSrc.includes("deriveStockFields"), "client must derive stock fields");
assert(clientSrc.includes('from("consumables")'), "client missing table");
assert(clientSrc.includes("staff_id} — {employee.full_name}"), "employee label");
assert(clientSrc.includes("site.site_name"), "site dropdown label");
assert(navSrc.includes("/dashboard/operations/consumables"), "ops nav missing");
assert(!navSrc.includes("hr-payroll/consumables"), "must not be under HR nav only");
console.log("PASS source: page/client/nav wired under Operations");

// --- Pure derive checks ---
assert(computeRemaining(10, 5, 3) === 12, "remaining 10+5-3");
assert(computeRemaining(null, null, null) === 0, "remaining nulls → 0");
assert(computeStockStatus(0, 5) === STOCK_STATUS_OUT, "0 → Out of Stock");
assert(computeStockStatus(-1, 5) === STOCK_STATUS_OUT, "negative → Out");
assert(computeStockStatus(5, 5) === STOCK_STATUS_LOW, "at min → Low Stock");
assert(computeStockStatus(4, 5) === STOCK_STATUS_LOW, "below min → Low");
assert(computeStockStatus(6, 5) === STOCK_STATUS_OK, "above min → OK");
assert(computeStockStatus(6, null) === STOCK_STATUS_OK, "no min → OK if >0");
const derivedOk = deriveStockFields({
  opening_stock: 20,
  qty_issued: 10,
  qty_used: 5,
  minimum_level: 10,
});
assert(derivedOk.remaining === 25 && derivedOk.stock_status === STOCK_STATUS_OK);
const derivedLow = deriveStockFields({
  opening_stock: 10,
  qty_issued: 0,
  qty_used: 6,
  minimum_level: 5,
});
assert(derivedLow.remaining === 4 && derivedLow.stock_status === STOCK_STATUS_LOW);
const derivedOut = deriveStockFields({
  opening_stock: 2,
  qty_issued: 0,
  qty_used: 2,
  minimum_level: 1,
});
assert(derivedOut.remaining === 0 && derivedOut.stock_status === STOCK_STATUS_OUT);
console.log("PASS derived remaining/stock_status math");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function pickEmployee(tenantId) {
  const { data, error } = await admin
    .from("employees")
    .select("employee_id, staff_id, full_name")
    .eq("tenant_id", tenantId)
    .order("employee_id")
    .limit(1);
  assert(!error, error?.message ?? "employee query failed");
  return data?.[0] ?? null;
}

async function ensureEmployee(tenantId, label) {
  const existing = await pickEmployee(tenantId);
  if (existing) return { ...existing, ephemeral: false };

  const { data: empCode, error: empErr } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "EMP",
    p_padding: 4,
  });
  assert(!empErr && empCode, empErr?.message ?? "EMP allocate failed");
  const { data: staffRaw, error: staffErr } = await admin.rpc(
    "generate_next_code",
    { p_tenant_id: tenantId, p_entity_type: "STAFF", p_padding: 4 },
  );
  assert(!staffErr && staffRaw, staffErr?.message ?? "STAFF allocate failed");
  const branded = /^([A-Z0-9]{2,5})-STAFF-(\d+)$/i.exec(String(staffRaw).trim());
  const staffCode = branded
    ? `${branded[1].toUpperCase()}${branded[2]}`
    : String(staffRaw).trim();

  const { data: inserted, error: insErr } = await admin
    .from("employees")
    .insert({
      tenant_id: tenantId,
      employee_id: empCode,
      staff_id: staffCode,
      full_name: `Consumables Test ${label} ${tag}`,
      employment_type: "Permanent",
      employment_status: "Active",
    })
    .select("employee_id, staff_id, full_name")
    .single();
  assert(!insErr && inserted, insErr?.message ?? "temp employee insert failed");
  return { ...inserted, ephemeral: true };
}

async function pickSite(tenantId) {
  const { data, error } = await admin
    .from("sites")
    .select("site_code, site_name")
    .eq("tenant_id", tenantId)
    .order("site_name")
    .limit(1);
  assert(!error, error?.message ?? "site query failed");
  return data?.[0] ?? null;
}

async function createTenantUser(tenantId, email, role = "hr") {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  const authUid = authData.user.id;
  const { error: acctErr } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    role,
    email,
    is_active: true,
    tenant_id: tenantId,
  });
  assert(!acctErr, acctErr?.message ?? "user_accounts insert failed");
  return authUid;
}

async function cleanupUser(authUid) {
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}

const davorsEmp = await ensureEmployee(DAVORS, "Davors");
const caantaEmp = await ensureEmployee(CAANTA, "Caanta");
const davorsSite = await pickSite(DAVORS);
const caantaSite = await pickSite(CAANTA);
assert(davorsSite, "Davors needs a site");
console.log("Davors employee:", davorsEmp.employee_id, "site:", davorsSite.site_code);
console.log(
  "Caanta employee:",
  caantaEmp.employee_id,
  caantaEmp.ephemeral ? "(ephemeral)" : "",
);

const davorsEmail = `cons.davors.${tag.toLowerCase()}@test.davors`;
const caantaEmail = `cons.caanta.${tag.toLowerCase()}@test.davors`;
let davorsUid = null;
let caantaUid = null;
const createdIds = [];

try {
  const scenarios = [
    {
      label: "OK",
      opening_stock: 20,
      qty_issued: 10,
      qty_used: 5,
      minimum_level: 10,
      expectRemaining: 25,
      expectStatus: STOCK_STATUS_OK,
    },
    {
      label: "Low Stock",
      opening_stock: 10,
      qty_issued: 0,
      qty_used: 6,
      minimum_level: 5,
      expectRemaining: 4,
      expectStatus: STOCK_STATUS_LOW,
    },
    {
      label: "Out of Stock",
      opening_stock: 2,
      qty_issued: 0,
      qty_used: 2,
      minimum_level: 1,
      expectRemaining: 0,
      expectStatus: STOCK_STATUS_OUT,
    },
  ];

  for (const scenario of scenarios) {
    const stock = deriveStockFields(scenario);
    assert(stock.remaining === scenario.expectRemaining, `${scenario.label} remaining`);
    assert(stock.stock_status === scenario.expectStatus, `${scenario.label} status`);

    const { data: row, error: insErr } = await admin
      .from("consumables")
      .insert({
        tenant_id: DAVORS,
        date: "2026-07-20",
        client_site: davorsSite.site_code,
        item: `${scenario.label} detergent ${tag}`,
        category: "Cleaning",
        unit: "litres",
        opening_stock: scenario.opening_stock,
        qty_issued: scenario.qty_issued,
        qty_used: scenario.qty_used,
        remaining: stock.remaining,
        minimum_level: scenario.minimum_level,
        stock_status: stock.stock_status,
        recorded_by: davorsEmp.employee_id,
        notes: `Staging ${scenario.label} ${tag}`,
      })
      .select("id, remaining, stock_status, item")
      .single();
    assert(!insErr && row, insErr?.message ?? `${scenario.label} insert failed`);
    createdIds.push(row.id);
    assert(Number(row.remaining) === scenario.expectRemaining, "persisted remaining");
    assert(row.stock_status === scenario.expectStatus, "persisted status");
    console.log(
      `PASS create ${scenario.label}: remaining=${row.remaining} status=${row.stock_status}`,
    );
  }

  // Edit OK row → push into Low Stock
  const editId = createdIds[0];
  const edited = deriveStockFields({
    opening_stock: 20,
    qty_issued: 10,
    qty_used: 22,
    minimum_level: 10,
  });
  assert(edited.remaining === 8 && edited.stock_status === STOCK_STATUS_LOW);

  const { data: updated, error: updateErr } = await admin
    .from("consumables")
    .update({
      qty_used: 22,
      remaining: edited.remaining,
      stock_status: edited.stock_status,
      notes: `Staging edit ${tag}`,
    })
    .eq("id", editId)
    .eq("tenant_id", DAVORS)
    .select("id, remaining, stock_status, notes")
    .single();
  assert(!updateErr && updated, updateErr?.message ?? "update failed");
  assert(Number(updated.remaining) === 8, "edit remaining");
  assert(updated.stock_status === STOCK_STATUS_LOW, "edit status");
  console.log("PASS edit OK → Low Stock (remaining 8)");

  // Caanta sibling
  const caantaStock = deriveStockFields({
    opening_stock: 5,
    qty_issued: 0,
    qty_used: 1,
    minimum_level: 2,
  });
  const { data: caantaRow, error: caantaInsErr } = await admin
    .from("consumables")
    .insert({
      tenant_id: CAANTA,
      date: "2026-07-21",
      client_site: caantaSite?.site_code ?? null,
      item: `Caanta bleach ${tag}`,
      category: "Cleaning",
      unit: "bottles",
      opening_stock: 5,
      qty_issued: 0,
      qty_used: 1,
      remaining: caantaStock.remaining,
      minimum_level: 2,
      stock_status: caantaStock.stock_status,
      recorded_by: caantaEmp.employee_id,
      notes: `Caanta isolation ${tag}`,
    })
    .select("id, tenant_id")
    .single();
  assert(!caantaInsErr && caantaRow, caantaInsErr?.message ?? "Caanta insert failed");
  createdIds.push(caantaRow.id);
  console.log("PASS create Caanta entry:", caantaRow.id);

  // RLS
  davorsUid = await createTenantUser(DAVORS, davorsEmail, "hr");
  caantaUid = await createTenantUser(CAANTA, caantaEmail, "hr");

  const davorsClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: davorsSignInErr } = await davorsClient.auth.signInWithPassword({
    email: davorsEmail,
    password: PASSWORD,
  });
  assert(!davorsSignInErr, davorsSignInErr?.message ?? "Davors sign-in failed");

  const { data: davorsSeen, error: davorsReadErr } = await davorsClient
    .from("consumables")
    .select("id, tenant_id, notes");
  assert(!davorsReadErr, davorsReadErr?.message ?? "Davors read failed");
  const davorsIds = new Set((davorsSeen ?? []).map((r) => r.id));
  for (const id of createdIds.slice(0, 3)) {
    assert(davorsIds.has(id), `Davors missing own id ${id}`);
  }
  assert(!davorsIds.has(caantaRow.id), "Davors saw Caanta — RLS FAIL");
  assert(
    (davorsSeen ?? []).every((r) => r.tenant_id === DAVORS),
    "Davors saw non-Davors tenant_id",
  );
  console.log(
    "PASS RLS Davors authenticated: sees",
    davorsSeen.length,
    "own-tenant row(s), not Caanta",
  );

  const caantaClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: caantaSignInErr } = await caantaClient.auth.signInWithPassword({
    email: caantaEmail,
    password: PASSWORD,
  });
  assert(!caantaSignInErr, caantaSignInErr?.message ?? "Caanta sign-in failed");

  const { data: caantaSeen, error: caantaReadErr } = await caantaClient
    .from("consumables")
    .select("id, tenant_id, notes");
  assert(!caantaReadErr, caantaReadErr?.message ?? "Caanta read failed");
  const caantaIds = new Set((caantaSeen ?? []).map((r) => r.id));
  assert(caantaIds.has(caantaRow.id), "Caanta cannot see own entry");
  for (const id of createdIds.slice(0, 3)) {
    assert(!caantaIds.has(id), `Caanta saw Davors id ${id} — RLS FAIL`);
  }
  assert(
    (caantaSeen ?? []).every((r) => r.tenant_id === CAANTA),
    "Caanta saw non-Caanta tenant_id",
  );
  console.log(
    "PASS RLS Caanta authenticated: sees",
    caantaSeen.length,
    "own-tenant row(s), not Davors",
  );

  // Auth UI-path create
  const uiStock = deriveStockFields({
    opening_stock: 8,
    qty_issued: 2,
    qty_used: 1,
    minimum_level: 3,
  });
  const { data: uiCreated, error: uiCreateErr } = await davorsClient
    .from("consumables")
    .insert({
      date: "2026-07-22",
      client_site: davorsSite.site_code,
      item: `UI Path soap ${tag}`,
      category: "Cleaning",
      unit: "packs",
      opening_stock: 8,
      qty_issued: 2,
      qty_used: 1,
      remaining: uiStock.remaining,
      minimum_level: 3,
      stock_status: uiStock.stock_status,
      recorded_by: davorsEmp.employee_id,
      notes: `UI-path create ${tag}`,
    })
    .select("id, tenant_id, remaining, stock_status")
    .single();
  assert(!uiCreateErr && uiCreated, uiCreateErr?.message ?? "auth create failed");
  assert(uiCreated.tenant_id === DAVORS, "auth insert tenant_id");
  assert(Number(uiCreated.remaining) === 9, "auth remaining");
  assert(uiCreated.stock_status === STOCK_STATUS_OK, "auth status");
  console.log("PASS authenticated insert (UI path):", uiCreated.id);

  await davorsClient.from("consumables").delete().eq("id", uiCreated.id);
  console.log("PASS authenticated delete cleanup of UI-path row");
} finally {
  await admin.from("consumables").delete().ilike("notes", `%${tag}%`);
  await admin.from("consumables").delete().ilike("item", `%${tag}%`);
  if (davorsUid) await cleanupUser(davorsUid);
  if (caantaUid) await cleanupUser(caantaUid);
  if (caantaEmp.ephemeral) {
    await admin
      .from("employees")
      .delete()
      .eq("tenant_id", CAANTA)
      .eq("employee_id", caantaEmp.employee_id);
  }
  if (davorsEmp.ephemeral) {
    await admin
      .from("employees")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("employee_id", davorsEmp.employee_id);
  }
  console.log("Cleanup done");
}

console.log("\nAll consumables staging checks passed.");
