/**
 * Staging: asset_register (staff kit) CRUD + STAFFKIT IDs + ASSET collision check + RLS.
 * Run: node scripts/test-asset-register-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "KitTest!2026Aa";
const tag = `KIT${Date.now().toString(36).toUpperCase()}`;

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
  resolve("app/dashboard/hr-payroll/asset-register/page.tsx"),
  "utf8",
);
const clientSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/asset-register.tsx"),
  "utf8",
);
const apiSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/staff-kit-id-api.ts"),
  "utf8",
);
const utilsSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/asset-register-utils.ts"),
  "utf8",
);
const navSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/hr-management-nav-config.ts"),
  "utf8",
);
assert(pageSrc.includes('from("asset_register")'), "page missing table");
assert(pageSrc.includes("createClient"), "page should use server createClient");
assert(!pageSrc.includes("createAdminClient"), "page must not use admin client");
assert(clientSrc.includes("allocateStaffKitId"), "client must allocate on save");
assert(clientSrc.includes('from("asset_register")'), "client missing table");
assert(clientSrc.includes("Not assigned (in storage)"), "nullable employee option missing");
assert(clientSrc.includes("staff_id} — {employee.full_name}"), "employee label pattern");
assert(apiSrc.includes('"STAFFKIT"'), "STAFFKIT entity type missing");
assert(!apiSrc.includes('"ASSET"'), "must not reuse ASSET entity type");
assert(utilsSrc.includes('"New"'), "condition list missing New");
assert(utilsSrc.includes('"Damaged"'), "condition list missing Damaged");
assert(navSrc.includes("/dashboard/hr-payroll/asset-register"), "nav missing Staff Kit");
console.log("PASS source: page/client/api/nav wired for asset_register (STAFFKIT)");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function allocateStaffKitId(tenantId) {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "STAFFKIT",
    p_padding: 4,
  });
  assert(!error && data, error?.message ?? "STAFFKIT allocate failed");
  return String(data).trim();
}

async function allocateAssetId(tenantId) {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "ASSET",
    p_padding: 4,
  });
  assert(!error && data, error?.message ?? "ASSET allocate failed");
  return String(data).trim();
}

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
  if (existing) {
    return { ...existing, ephemeral: false };
  }

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
      full_name: `Staff Kit Test ${label} ${tag}`,
      employment_type: "Permanent",
      employment_status: "Active",
    })
    .select("employee_id, staff_id, full_name")
    .single();
  assert(!insErr && inserted, insErr?.message ?? "temp employee insert failed");
  return { ...inserted, ephemeral: true };
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
console.log("Davors employee:", davorsEmp.employee_id);
console.log(
  "Caanta employee:",
  caantaEmp.employee_id,
  caantaEmp.ephemeral ? "(ephemeral)" : "",
);

const { data: seqBefore } = await admin
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", DAVORS)
  .in("entity_type", ["ASSET", "STAFFKIT"]);
console.log("Davors sequences before:", seqBefore);

const davorsEmail = `kit.davors.${tag.toLowerCase()}@test.davors`;
const caantaEmail = `kit.caanta.${tag.toLowerCase()}@test.davors`;
let davorsUid = null;
let caantaUid = null;
let davorsIdAssigned = null;
let davorsIdStorage = null;
let caantaId = null;
let financeAssetPeek = null;

try {
  // Peek Finance ASSET counter without colliding namespaces
  financeAssetPeek = await allocateAssetId(DAVORS);
  assert(/^DF-ASSET-\d{4}$/.test(financeAssetPeek), `ASSET format: ${financeAssetPeek}`);
  console.log("PASS Finance ASSET allocate (separate counter):", financeAssetPeek);

  // --- Create with employee assigned ---
  davorsIdAssigned = await allocateStaffKitId(DAVORS);
  assert(
    /^DF-STAFFKIT-\d{4}$/.test(davorsIdAssigned),
    `STAFFKIT format: ${davorsIdAssigned}`,
  );
  assert(
    !davorsIdAssigned.startsWith("DF-ASSET-"),
    "STAFFKIT must not use ASSET prefix",
  );
  assert(davorsIdAssigned !== financeAssetPeek, "STAFFKIT collided with ASSET id string");

  const { data: createdAssigned, error: createAssignedErr } = await admin
    .from("asset_register")
    .insert({
      tenant_id: DAVORS,
      asset_id: davorsIdAssigned,
      employee_id: davorsEmp.employee_id,
      asset_name: `Phone ${tag}`,
      date_issued: "2026-07-01",
      date_returned: null,
      condition: "Good",
    })
    .select("*")
    .single();
  assert(
    !createAssignedErr && createdAssigned,
    createAssignedErr?.message ?? "create with employee failed",
  );
  assert(createdAssigned.employee_id === davorsEmp.employee_id, "employee_id not set");
  console.log("PASS create with employee:", davorsIdAssigned);

  // --- Create without employee (storage) ---
  davorsIdStorage = await allocateStaffKitId(DAVORS);
  assert(davorsIdStorage !== davorsIdAssigned, "second STAFFKIT id collided");
  assert(/^DF-STAFFKIT-\d{4}$/.test(davorsIdStorage), `format: ${davorsIdStorage}`);

  const { data: createdStorage, error: createStorageErr } = await admin
    .from("asset_register")
    .insert({
      tenant_id: DAVORS,
      asset_id: davorsIdStorage,
      employee_id: null,
      asset_name: `Uniform set ${tag}`,
      date_issued: null,
      date_returned: null,
      condition: "New",
    })
    .select("*")
    .single();
  assert(
    !createStorageErr && createdStorage,
    createStorageErr?.message ?? "create without employee failed",
  );
  assert(createdStorage.employee_id === null, "storage item should have null employee_id");
  console.log("PASS create without employee (storage):", davorsIdStorage);

  // --- Edit: assign storage item + return date ---
  const { data: updated, error: updateErr } = await admin
    .from("asset_register")
    .update({
      employee_id: davorsEmp.employee_id,
      date_issued: "2026-07-15",
      condition: "Fair",
      date_returned: null,
    })
    .eq("tenant_id", DAVORS)
    .eq("asset_id", davorsIdStorage)
    .select("asset_id, employee_id, condition, date_issued")
    .single();
  assert(!updateErr && updated, updateErr?.message ?? "update failed");
  assert(updated.employee_id === davorsEmp.employee_id, "edit employee not set");
  assert(updated.condition === "Fair", "condition not updated");
  console.log("PASS edit storage item → assigned + Fair");

  // Confirm no ASSET-prefixed rows landed in asset_register from our allocates
  const { data: assetPrefixed, error: prefixErr } = await admin
    .from("asset_register")
    .select("asset_id")
    .eq("tenant_id", DAVORS)
    .like("asset_id", "DF-ASSET-%");
  assert(!prefixErr, prefixErr?.message);
  assert(
    (assetPrefixed ?? []).length === 0,
    `asset_register has ASSET-prefixed ids: ${(assetPrefixed ?? []).map((r) => r.asset_id).join(", ")}`,
  );
  console.log("PASS no DF-ASSET- IDs in asset_register for Davors");

  // Confirm ASSET sequence was not advanced by STAFFKIT allocates
  const { data: seqAfter } = await admin
    .from("id_sequences")
    .select("entity_type, next_value")
    .eq("tenant_id", DAVORS)
    .in("entity_type", ["ASSET", "STAFFKIT"]);
  const assetSeq = seqAfter?.find((r) => r.entity_type === "ASSET");
  const kitSeq = seqAfter?.find((r) => r.entity_type === "STAFFKIT");
  assert(kitSeq, "STAFFKIT sequence row missing");
  console.log("PASS sequences after:", seqAfter);
  assert(assetSeq, "ASSET sequence should exist after Finance peek allocate");

  // --- Caanta sibling ---
  caantaId = await allocateStaffKitId(CAANTA);
  assert(/^CAN-STAFFKIT-\d{4}$/.test(caantaId), `Caanta format: ${caantaId}`);

  const { data: caantaRow, error: caantaInsErr } = await admin
    .from("asset_register")
    .insert({
      tenant_id: CAANTA,
      asset_id: caantaId,
      employee_id: caantaEmp.employee_id,
      asset_name: `Caanta radio ${tag}`,
      date_issued: "2026-07-10",
      date_returned: null,
      condition: "Good",
    })
    .select("asset_id, tenant_id")
    .single();
  assert(!caantaInsErr && caantaRow, caantaInsErr?.message ?? "Caanta insert failed");
  console.log("PASS create Caanta kit:", caantaId);

  // --- Authenticated RLS ---
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
    .from("asset_register")
    .select("asset_id, tenant_id, asset_name");
  assert(!davorsReadErr, davorsReadErr?.message ?? "Davors read failed");
  const davorsIds = new Set((davorsSeen ?? []).map((r) => r.asset_id));
  assert(davorsIds.has(davorsIdAssigned), "Davors cannot see assigned kit");
  assert(davorsIds.has(davorsIdStorage), "Davors cannot see storage kit");
  assert(!davorsIds.has(caantaId), "Davors saw Caanta kit — RLS FAIL");
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
    .from("asset_register")
    .select("asset_id, tenant_id, asset_name");
  assert(!caantaReadErr, caantaReadErr?.message ?? "Caanta read failed");
  const caantaIds = new Set((caantaSeen ?? []).map((r) => r.asset_id));
  assert(caantaIds.has(caantaId), "Caanta cannot see own kit");
  assert(!caantaIds.has(davorsIdAssigned), "Caanta saw Davors kit — RLS FAIL");
  assert(!caantaIds.has(davorsIdStorage), "Caanta saw Davors storage kit — RLS FAIL");
  assert(
    (caantaSeen ?? []).every((r) => r.tenant_id === CAANTA),
    "Caanta saw non-Caanta tenant_id",
  );
  console.log(
    "PASS RLS Caanta authenticated: sees",
    caantaSeen.length,
    "own-tenant row(s), not Davors",
  );

  // Auth UI-path: create unassigned then update
  const { data: uiCode, error: uiAllocErr } = await davorsClient.rpc(
    "generate_next_code",
    { p_tenant_id: DAVORS, p_entity_type: "STAFFKIT", p_padding: 4 },
  );
  assert(!uiAllocErr && uiCode, uiAllocErr?.message ?? "auth allocate failed");
  assert(String(uiCode).includes("STAFFKIT"), `auth allocate not STAFFKIT: ${uiCode}`);

  const { data: uiCreated, error: uiCreateErr } = await davorsClient
    .from("asset_register")
    .insert({
      asset_id: uiCode,
      employee_id: null,
      asset_name: `UI Path ${tag}`,
      date_issued: null,
      date_returned: null,
      condition: "New",
    })
    .select("asset_id, tenant_id, employee_id")
    .single();
  assert(!uiCreateErr && uiCreated, uiCreateErr?.message ?? "auth create failed");
  assert(uiCreated.tenant_id === DAVORS, "auth insert tenant_id should be Davors");
  assert(uiCreated.employee_id === null, "UI path should allow null employee");
  console.log("PASS authenticated insert unassigned:", uiCreated.asset_id);

  const { data: uiUpdated, error: uiUpdateErr } = await davorsClient
    .from("asset_register")
    .update({
      employee_id: davorsEmp.employee_id,
      date_issued: "2026-07-20",
      condition: "Damaged",
    })
    .eq("asset_id", uiCreated.asset_id)
    .select("asset_id, employee_id, condition")
    .single();
  assert(
    !uiUpdateErr &&
      uiUpdated?.employee_id === davorsEmp.employee_id &&
      uiUpdated?.condition === "Damaged",
    uiUpdateErr?.message ?? "auth update failed",
  );
  console.log("PASS authenticated update (assign + Damaged)");

  await davorsClient
    .from("asset_register")
    .delete()
    .eq("asset_id", uiCreated.asset_id);
  console.log("PASS authenticated delete cleanup of UI-path row");
} finally {
  for (const id of [davorsIdAssigned, davorsIdStorage]) {
    if (id) {
      await admin
        .from("asset_register")
        .delete()
        .eq("tenant_id", DAVORS)
        .eq("asset_id", id);
    }
  }
  if (caantaId) {
    await admin
      .from("asset_register")
      .delete()
      .eq("tenant_id", CAANTA)
      .eq("asset_id", caantaId);
  }
  if (davorsUid) await cleanupUser(davorsUid);
  if (caantaUid) await cleanupUser(caantaUid);
  await admin.from("asset_register").delete().ilike("asset_name", `%${tag}%`);
  // Note: financeAssetPeek burned one ASSET sequence number on staging — intentional collision check.
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

console.log("\nAll staff kit asset_register staging checks passed.");
