/**
 * Staging: disciplinary_records CRUD + tenant RLS isolation.
 * Mirrors app client pattern (authenticated anon key, not service role for reads).
 *
 * Run: node scripts/test-disciplinary-register-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "DiscTest!2026Aa";
const tag = `DISC${Date.now().toString(36).toUpperCase()}`;

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
  resolve("app/dashboard/hr-payroll/disciplinary/page.tsx"),
  "utf8",
);
const clientSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/disciplinary-register.tsx"),
  "utf8",
);
const navSrc = readFileSync(
  resolve("app/dashboard/hr-payroll/hr-management-nav-config.ts"),
  "utf8",
);
assert(pageSrc.includes('from("disciplinary_records")'), "page missing table query");
assert(pageSrc.includes("createClient"), "page should use server createClient");
assert(!pageSrc.includes("createAdminClient"), "page must not use admin client");
assert(clientSrc.includes('from("disciplinary_records")'), "client missing table");
assert(clientSrc.includes("staff_id} — {employee.full_name}"), "employee label pattern");
assert(navSrc.includes("/dashboard/hr-payroll/disciplinary"), "nav missing Disciplinary");
console.log("PASS source: page/client/nav wired for disciplinary_records");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function pickEmployee(tenantId) {
  const { data, error } = await admin
    .from("employees")
    .select("employee_id, staff_id, full_name")
    .eq("tenant_id", tenantId)
    .order("employee_id")
    .limit(5);
  assert(!error, `Employee query failed for ${tenantId}: ${error?.message}`);
  if (data?.length) {
    return { employee: data[0], created: false };
  }
  return { employee: null, created: false };
}

async function ensureEmployee(tenantId, label) {
  const picked = await pickEmployee(tenantId);
  if (picked.employee) {
    return { ...picked.employee, ephemeral: false };
  }

  const { data: empCode, error: empErr } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "EMP",
    p_padding: 4,
  });
  assert(!empErr && empCode, empErr?.message ?? "EMP allocate failed");
  const { data: staffCode, error: staffErr } = await admin.rpc(
    "generate_next_code",
    { p_tenant_id: tenantId, p_entity_type: "STAFF", p_padding: 4 },
  );
  assert(!staffErr && staffCode, staffErr?.message ?? "STAFF allocate failed");

  const row = {
    tenant_id: tenantId,
    employee_id: empCode,
    staff_id: staffCode,
    full_name: `Disciplinary Test ${label} ${tag}`,
    employment_type: "Permanent",
    employment_status: "Active",
  };
  const { data: inserted, error: insErr } = await admin
    .from("employees")
    .insert(row)
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
console.log("Davors employee:", davorsEmp.employee_id, davorsEmp.staff_id);
console.log(
  "Caanta employee:",
  caantaEmp.employee_id,
  caantaEmp.staff_id,
  caantaEmp.ephemeral ? "(ephemeral)" : "",
);

const davorsEmail = `disc.davors.${tag.toLowerCase()}@test.davors`;
const caantaEmail = `disc.caanta.${tag.toLowerCase()}@test.davors`;
let davorsUid = null;
let caantaUid = null;
let davorsRecordId = null;
let caantaRecordId = null;

try {
  // --- Admin create (seed) ---
  const { data: created, error: createErr } = await admin
    .from("disciplinary_records")
    .insert({
      tenant_id: DAVORS,
      employee_id: davorsEmp.employee_id,
      incident_date: "2026-07-20",
      description: `Staging create ${tag}`,
      action_taken: "Counselling session",
      warning_level: "Verbal",
    })
    .select("id, employee_id, incident_date, description, warning_level, tenant_id")
    .single();
  assert(!createErr && created, createErr?.message ?? "create failed");
  davorsRecordId = created.id;
  assert(created.tenant_id === DAVORS, "Davors tenant_id mismatch on create");
  console.log("PASS create Davors record:", davorsRecordId);

  // --- Edit ---
  const { data: updated, error: updateErr } = await admin
    .from("disciplinary_records")
    .update({
      warning_level: "Written",
      action_taken: `Written warning issued ${tag}`,
      description: `Staging edit ${tag}`,
    })
    .eq("id", davorsRecordId)
    .eq("tenant_id", DAVORS)
    .select("id, warning_level, action_taken, description")
    .single();
  assert(!updateErr && updated, updateErr?.message ?? "update failed");
  assert(updated.warning_level === "Written", "warning_level not updated");
  assert(updated.description.includes("edit"), "description not updated");
  console.log("PASS edit Davors record → Written");

  // --- List appears ---
  const { data: list, error: listErr } = await admin
    .from("disciplinary_records")
    .select("id, warning_level, description")
    .eq("tenant_id", DAVORS)
    .eq("id", davorsRecordId);
  assert(!listErr && list?.length === 1, listErr?.message ?? "list miss");
  console.log("PASS list contains edited record");

  // --- Caanta sibling row ---
  const { data: caantaRow, error: caantaInsErr } = await admin
    .from("disciplinary_records")
    .insert({
      tenant_id: CAANTA,
      employee_id: caantaEmp.employee_id,
      incident_date: "2026-07-21",
      description: `Caanta isolation ${tag}`,
      action_taken: null,
      warning_level: "Final Warning",
    })
    .select("id, tenant_id")
    .single();
  assert(!caantaInsErr && caantaRow, caantaInsErr?.message ?? "Caanta insert failed");
  caantaRecordId = caantaRow.id;
  console.log("PASS create Caanta record:", caantaRecordId);

  // --- Authenticated RLS (app client pattern) ---
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
    .from("disciplinary_records")
    .select("id, tenant_id, description");
  assert(!davorsReadErr, davorsReadErr?.message ?? "Davors read failed");
  const davorsIds = new Set((davorsSeen ?? []).map((r) => r.id));
  assert(davorsIds.has(davorsRecordId), "Davors user cannot see own record");
  assert(!davorsIds.has(caantaRecordId), "Davors user saw Caanta record — RLS FAIL");
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
    .from("disciplinary_records")
    .select("id, tenant_id, description");
  assert(!caantaReadErr, caantaReadErr?.message ?? "Caanta read failed");
  const caantaIds = new Set((caantaSeen ?? []).map((r) => r.id));
  assert(caantaIds.has(caantaRecordId), "Caanta user cannot see own record");
  assert(!caantaIds.has(davorsRecordId), "Caanta user saw Davors record — RLS FAIL");
  assert(
    (caantaSeen ?? []).every((r) => r.tenant_id === CAANTA),
    "Caanta user saw non-Caanta tenant_id",
  );
  console.log(
    "PASS RLS Caanta authenticated: sees",
    caantaSeen.length,
    "own-tenant row(s), not Davors",
  );

  // Authenticated create/update like the UI client
  const { data: uiCreated, error: uiCreateErr } = await davorsClient
    .from("disciplinary_records")
    .insert({
      employee_id: davorsEmp.employee_id,
      incident_date: "2026-07-22",
      description: `UI-path create ${tag}`,
      action_taken: "Meeting",
      warning_level: "Verbal",
    })
    .select("id, tenant_id")
    .single();
  assert(!uiCreateErr && uiCreated, uiCreateErr?.message ?? "auth create failed");
  assert(uiCreated.tenant_id === DAVORS, "auth insert tenant_id should be Davors");
  console.log("PASS authenticated insert (UI path):", uiCreated.id);

  const { data: uiUpdated, error: uiUpdateErr } = await davorsClient
    .from("disciplinary_records")
    .update({ warning_level: "Suspension" })
    .eq("id", uiCreated.id)
    .select("id, warning_level")
    .single();
  assert(!uiUpdateErr && uiUpdated?.warning_level === "Suspension", uiUpdateErr?.message);
  console.log("PASS authenticated update (UI path)");

  await davorsClient.from("disciplinary_records").delete().eq("id", uiCreated.id);
  console.log("PASS authenticated delete cleanup of UI-path row");
} finally {
  if (davorsRecordId) {
    await admin.from("disciplinary_records").delete().eq("id", davorsRecordId);
  }
  if (caantaRecordId) {
    await admin.from("disciplinary_records").delete().eq("id", caantaRecordId);
  }
  if (davorsUid) await cleanupUser(davorsUid);
  if (caantaUid) await cleanupUser(caantaUid);
  // Sweep any leftover tagged rows
  await admin
    .from("disciplinary_records")
    .delete()
    .ilike("description", `%${tag}%`);
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

console.log("\nAll disciplinary register staging checks passed.");
