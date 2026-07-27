/**
 * Staging: equipment_register CRUD + EQUIPMENT ID allocation + tenant RLS.
 * Run: node scripts/test-equipment-register-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "EquipTest!2026Aa";
const tag = `EQUIP${Date.now().toString(36).toUpperCase()}`;

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
  resolve("app/dashboard/hr-payroll/equipment/page.tsx"),
  "utf8",
);
const clientSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/equipment-register.tsx"),
  "utf8",
);
const apiSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/equipment-id-api.ts"),
  "utf8",
);
const navSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/hr-management-nav-config.ts"),
  "utf8",
);
assert(pageSrc.includes('from("equipment_register")'), "page missing table");
assert(pageSrc.includes('from("equipment_status_options")'), "page missing status options");
assert(pageSrc.includes("createClient"), "page should use server createClient");
assert(!pageSrc.includes("createAdminClient"), "page must not use admin client");
assert(clientSrc.includes("allocateEquipmentId"), "client must allocate on save");
assert(clientSrc.includes('from("equipment_register")'), "client missing table");
assert(clientSrc.includes("staff_id} — {employee.full_name}"), "employee label pattern");
assert(clientSrc.includes("site.site_name"), "site dropdown should show site_name");
assert(clientSrc.includes('type="checkbox"'), "service_alert checkbox missing");
assert(apiSrc.includes('p_entity_type: EQUIPMENT_ID_ENTITY_TYPE'), "api entity wiring");
assert(apiSrc.includes('"EQUIPMENT"'), "EQUIPMENT entity type missing");
assert(navSrc.includes("/dashboard/hr-payroll/equipment"), "nav missing Equipment");
console.log("PASS source: page/client/api/nav wired for equipment_register");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function allocateEquipmentId(tenantId) {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "EQUIPMENT",
    p_padding: 4,
  });
  assert(!error && data, error?.message ?? "EQUIPMENT allocate failed");
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
      full_name: `Equipment Test ${label} ${tag}`,
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

async function ensureStatusOptions(tenantId) {
  const names = ["Operational", "Under Maintenance", "Faulty"];
  for (const name of names) {
    const { error } = await admin.from("equipment_status_options").upsert(
      { tenant_id: tenantId, name },
      { onConflict: "tenant_id,name" },
    );
    assert(!error, `status option upsert failed: ${error?.message}`);
  }
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

await ensureStatusOptions(DAVORS);
await ensureStatusOptions(CAANTA);

const davorsEmp = await ensureEmployee(DAVORS, "Davors");
const caantaEmp = await ensureEmployee(CAANTA, "Caanta");
const davorsSite = await pickSite(DAVORS);
const caantaSite = await pickSite(CAANTA);
assert(davorsSite, "Davors needs at least one site");
console.log("Davors employee:", davorsEmp.employee_id, "site:", davorsSite.site_code);
console.log(
  "Caanta employee:",
  caantaEmp.employee_id,
  caantaEmp.ephemeral ? "(ephemeral)" : "",
  "site:",
  caantaSite?.site_code ?? "(none)",
);

const { data: statusOpts, error: statusErr } = await admin
  .from("equipment_status_options")
  .select("name")
  .eq("tenant_id", DAVORS)
  .order("name");
assert(!statusErr && statusOpts?.length, statusErr?.message ?? "no status options");
console.log(
  "PASS status options (Davors):",
  statusOpts.map((r) => r.name).join(", "),
);

const davorsEmail = `equip.davors.${tag.toLowerCase()}@test.davors`;
const caantaEmail = `equip.caanta.${tag.toLowerCase()}@test.davors`;
let davorsUid = null;
let caantaUid = null;
let davorsId1 = null;
let davorsId2 = null;
let caantaId = null;

try {
  // --- Create #1 with all fields ---
  davorsId1 = await allocateEquipmentId(DAVORS);
  assert(/^DF-EQUIPMENT-\d{4}$/.test(davorsId1), `unexpected id ${davorsId1}`);

  const { data: created, error: createErr } = await admin
    .from("equipment_register")
    .insert({
      tenant_id: DAVORS,
      equipment_id: davorsId1,
      equipment_name: `Floor Scrubber ${tag}`,
      category: "Cleaning",
      serial_number: `SN-${tag}-1`,
      assigned_to: davorsEmp.employee_id,
      assigned_site: davorsSite.site_code,
      condition: "Good",
      purchase_date: "2025-01-15",
      last_maintenance: "2026-06-01",
      next_service_due: "2026-09-01",
      current_status: "Operational",
      service_alert: true,
      notes: `Staging create ${tag}`,
    })
    .select("*")
    .single();
  assert(!createErr && created, createErr?.message ?? "create failed");
  assert(created.equipment_id === davorsId1, "equipment_id mismatch");
  assert(created.assigned_to === davorsEmp.employee_id, "assigned_to mismatch");
  assert(created.assigned_site === davorsSite.site_code, "assigned_site mismatch");
  assert(created.service_alert === true, "service_alert not persisted");
  assert(created.current_status === "Operational", "status mismatch");
  console.log("PASS create Davors equipment:", davorsId1);

  // --- Edit ---
  const { data: updated, error: updateErr } = await admin
    .from("equipment_register")
    .update({
      current_status: "Under Maintenance",
      service_alert: false,
      condition: "Needs parts",
      notes: `Staging edit ${tag}`,
    })
    .eq("tenant_id", DAVORS)
    .eq("equipment_id", davorsId1)
    .select("equipment_id, current_status, service_alert, condition, notes")
    .single();
  assert(!updateErr && updated, updateErr?.message ?? "update failed");
  assert(updated.current_status === "Under Maintenance", "status not updated");
  assert(updated.service_alert === false, "service_alert not cleared");
  assert(updated.notes.includes("edit"), "notes not updated");
  console.log("PASS edit Davors equipment → Under Maintenance");

  // --- Second create: no ID collision ---
  davorsId2 = await allocateEquipmentId(DAVORS);
  assert(davorsId2 !== davorsId1, "second equipment_id collided with first");
  assert(/^DF-EQUIPMENT-\d{4}$/.test(davorsId2), `unexpected id ${davorsId2}`);

  const { data: created2, error: create2Err } = await admin
    .from("equipment_register")
    .insert({
      tenant_id: DAVORS,
      equipment_id: davorsId2,
      equipment_name: `Vacuum ${tag}`,
      category: "Cleaning",
      serial_number: `SN-${tag}-2`,
      assigned_to: davorsEmp.employee_id,
      assigned_site: davorsSite.site_code,
      condition: "Fair",
      purchase_date: "2024-08-01",
      last_maintenance: "2026-05-01",
      next_service_due: "2026-08-01",
      current_status: "Faulty",
      service_alert: true,
      notes: `Staging create 2 ${tag}`,
    })
    .select("equipment_id, tenant_id")
    .single();
  assert(!create2Err && created2, create2Err?.message ?? "second create failed");
  console.log("PASS second create no collision:", davorsId1, "vs", davorsId2);

  // --- Caanta sibling ---
  caantaId = await allocateEquipmentId(CAANTA);
  assert(/^CAN-EQUIPMENT-\d{4}$/.test(caantaId), `Caanta id format: ${caantaId}`);

  const { data: caantaRow, error: caantaInsErr } = await admin
    .from("equipment_register")
    .insert({
      tenant_id: CAANTA,
      equipment_id: caantaId,
      equipment_name: `Caanta Blower ${tag}`,
      category: "Outdoor",
      serial_number: `SN-CAN-${tag}`,
      assigned_to: caantaEmp.employee_id,
      assigned_site: caantaSite?.site_code ?? null,
      condition: "Good",
      purchase_date: "2026-02-01",
      last_maintenance: null,
      next_service_due: "2026-12-01",
      current_status: "Operational",
      service_alert: false,
      notes: `Caanta isolation ${tag}`,
    })
    .select("equipment_id, tenant_id")
    .single();
  assert(!caantaInsErr && caantaRow, caantaInsErr?.message ?? "Caanta insert failed");
  console.log("PASS create Caanta equipment:", caantaId);

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
    .from("equipment_register")
    .select("equipment_id, tenant_id, notes");
  assert(!davorsReadErr, davorsReadErr?.message ?? "Davors read failed");
  const davorsIds = new Set((davorsSeen ?? []).map((r) => r.equipment_id));
  assert(davorsIds.has(davorsId1), "Davors user cannot see own equipment");
  assert(davorsIds.has(davorsId2), "Davors user cannot see second equipment");
  assert(!davorsIds.has(caantaId), "Davors user saw Caanta equipment — RLS FAIL");
  assert(
    (davorsSeen ?? []).every((r) => r.tenant_id === DAVORS),
    "Davors user saw non-Davors tenant_id",
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
    .from("equipment_register")
    .select("equipment_id, tenant_id, notes");
  assert(!caantaReadErr, caantaReadErr?.message ?? "Caanta read failed");
  const caantaIds = new Set((caantaSeen ?? []).map((r) => r.equipment_id));
  assert(caantaIds.has(caantaId), "Caanta user cannot see own equipment");
  assert(!caantaIds.has(davorsId1), "Caanta user saw Davors equipment — RLS FAIL");
  assert(!caantaIds.has(davorsId2), "Caanta user saw Davors equipment 2 — RLS FAIL");
  assert(
    (caantaSeen ?? []).every((r) => r.tenant_id === CAANTA),
    "Caanta user saw non-Caanta tenant_id",
  );
  console.log(
    "PASS RLS Caanta authenticated: sees",
    caantaSeen.length,
    "own-tenant row(s), not Davors",
  );

  // Authenticated create/update like the UI client (allocate then insert)
  const { data: uiCode, error: uiAllocErr } = await davorsClient.rpc(
    "generate_next_code",
    { p_tenant_id: DAVORS, p_entity_type: "EQUIPMENT", p_padding: 4 },
  );
  assert(!uiAllocErr && uiCode, uiAllocErr?.message ?? "auth allocate failed");

  const { data: uiCreated, error: uiCreateErr } = await davorsClient
    .from("equipment_register")
    .insert({
      equipment_id: uiCode,
      equipment_name: `UI Path ${tag}`,
      category: "Test",
      serial_number: `UI-${tag}`,
      assigned_to: davorsEmp.employee_id,
      assigned_site: davorsSite.site_code,
      condition: "Good",
      purchase_date: "2026-03-01",
      last_maintenance: "2026-07-01",
      next_service_due: "2026-10-01",
      current_status: "Operational",
      service_alert: false,
      notes: `UI-path create ${tag}`,
    })
    .select("equipment_id, tenant_id")
    .single();
  assert(!uiCreateErr && uiCreated, uiCreateErr?.message ?? "auth create failed");
  assert(uiCreated.tenant_id === DAVORS, "auth insert tenant_id should be Davors");
  console.log("PASS authenticated insert (UI path):", uiCreated.equipment_id);

  const { data: uiUpdated, error: uiUpdateErr } = await davorsClient
    .from("equipment_register")
    .update({ current_status: "Faulty", service_alert: true })
    .eq("equipment_id", uiCreated.equipment_id)
    .select("equipment_id, current_status, service_alert")
    .single();
  assert(
    !uiUpdateErr &&
      uiUpdated?.current_status === "Faulty" &&
      uiUpdated?.service_alert === true,
    uiUpdateErr?.message ?? "auth update failed",
  );
  console.log("PASS authenticated update (UI path)");

  await davorsClient
    .from("equipment_register")
    .delete()
    .eq("equipment_id", uiCreated.equipment_id);
  console.log("PASS authenticated delete cleanup of UI-path row");
} finally {
  if (davorsId1) {
    await admin
      .from("equipment_register")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("equipment_id", davorsId1);
  }
  if (davorsId2) {
    await admin
      .from("equipment_register")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("equipment_id", davorsId2);
  }
  if (caantaId) {
    await admin
      .from("equipment_register")
      .delete()
      .eq("tenant_id", CAANTA)
      .eq("equipment_id", caantaId);
  }
  if (davorsUid) await cleanupUser(davorsUid);
  if (caantaUid) await cleanupUser(caantaUid);
  await admin
    .from("equipment_register")
    .delete()
    .ilike("notes", `%${tag}%`);
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

console.log("\nAll equipment register staging checks passed.");
