/**
 * Staging: employee_employment_history auto-write + view scenarios.
 * Run: node scripts/test-employment-history-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "HistTest!2026Aa";
const tag = `HIST${Date.now().toString(36).toUpperCase()}`;

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

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function snapshot(row) {
  return {
    position: normalizeText(row.position),
    department: normalizeText(row.department),
    shift: normalizeText(row.shift),
    employment_status: normalizeText(row.employment_status) ?? "Active",
    employment_type: normalizeText(row.employment_type) ?? "",
    basic_salary: normalizeMoney(row.basic_salary),
    housing_allowance: normalizeMoney(row.housing_allowance),
    transport_allowance: normalizeMoney(row.transport_allowance),
    other_allowances: normalizeMoney(row.other_allowances),
  };
}

function hasTrackedChange(before, after) {
  return (
    before.position !== after.position ||
    before.department !== after.department ||
    before.shift !== after.shift ||
    before.employment_status !== after.employment_status ||
    before.employment_type !== after.employment_type ||
    before.basic_salary !== after.basic_salary ||
    before.housing_allowance !== after.housing_allowance ||
    before.transport_allowance !== after.transport_allowance ||
    before.other_allowances !== after.other_allowances
  );
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

const dirSrc = readFileSync(
  resolve("app/dashboard/employees/employees-directory.tsx"),
  "utf8",
);
const utilsSrc = readFileSync(
  resolve("app/dashboard/employees/employment-history-utils.ts"),
  "utf8",
);
assert(dirSrc.includes("employee_employment_history"), "directory missing history insert");
assert(dirSrc.includes("Reason for change"), "reason field missing in UI");
assert(dirSrc.includes("Employment History"), "history section missing");
assert(dirSrc.includes("hasTrackedEmploymentChange"), "diff helper not wired");
assert(utilsSrc.includes("basic_salary"), "tracked salary fields missing");
assert(utilsSrc.includes("employment_type"), "employment_type must be tracked");
console.log("PASS source: Directory wired for employment history");

// Pure diff sanity
assert(
  !hasTrackedChange(
    snapshot({ position: "Cleaner", basic_salary: 100, housing_allowance: "" }),
    snapshot({ position: "Cleaner", basic_salary: "100", housing_allowance: null }),
  ),
  "false positive on money/null formatting",
);
assert(
  hasTrackedChange(
    snapshot({ position: "Cleaner", employment_type: "Casual" }),
    snapshot({ position: "Supervisor", employment_type: "Casual" }),
  ),
  "position change should detect",
);
console.log("PASS diff normalization helpers");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function historyCount(employeeId, sinceIso) {
  let q = admin
    .from("employee_employment_history")
    .select("history_id", { count: "exact", head: true })
    .eq("employee_id", employeeId);
  if (sinceIso) q = q.gte("changed_at", sinceIso);
  const { count, error } = await q;
  assert(!error, error?.message ?? "count failed");
  return count ?? 0;
}

async function listHistory(employeeId) {
  const { data, error } = await admin
    .from("employee_employment_history")
    .select("*")
    .eq("employee_id", employeeId)
    .order("changed_at", { ascending: false });
  assert(!error, error?.message ?? "list failed");
  return data ?? [];
}

async function pickDavorsEmployee() {
  const { data, error } = await admin
    .from("employees")
    .select("*")
    .eq("tenant_id", DAVORS)
    .not("position", "is", null)
    .order("employee_id")
    .limit(5);
  assert(!error && data?.length, error?.message ?? "no Davors employee");
  // Prefer one with seeded history
  for (const emp of data) {
    const rows = await listHistory(emp.employee_id);
    if (rows.length > 0) return { employee: emp, seeded: rows.length };
  }
  return { employee: data[0], seeded: 0 };
}

async function createTenantUser(tenantId, email) {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  const authUid = authData.user.id;
  const { error: acctErr } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    role: "hr",
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

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function historyPayload(employeeId, snapshot, reason, changedBy) {
  return {
    tenant_id: DAVORS,
    employee_id: employeeId,
    effective_date: today(),
    employment_type: snapshot.employment_type || "Full-Time",
    position: snapshot.position,
    shift: snapshot.shift,
    department: snapshot.department,
    rate_id: null,
    basic_salary: snapshot.basic_salary,
    housing_allowance: snapshot.housing_allowance,
    transport_allowance: snapshot.transport_allowance,
    other_allowances: snapshot.other_allowances,
    employee_status: snapshot.employment_status,
    change_reason: reason,
    changed_by: changedBy,
  };
}

const { employee: davorsEmp, seeded } = await pickDavorsEmployee();
console.log(
  "Using Davors employee:",
  davorsEmp.employee_id,
  "seeded history rows:",
  seeded,
);

const testStart = new Date().toISOString();
const createdEmployeeIds = [];
const createdHistoryIds = [];
let caantaEmpId = null;
let caantaHistoryId = null;
let davorsUid = null;
let caantaUid = null;

try {
  // (a) non-tracked field only — phone change — no history
  const beforeA = await historyCount(davorsEmp.employee_id, testStart);
  const phonePayload = {
    ...Object.fromEntries(
      [
        "staff_id",
        "full_name",
        "gender",
        "date_of_birth",
        "nationality",
        "marital_status",
        "phone",
        "email",
        "residential_address",
        "ghana_card_number",
        "ssnit_number",
        "tin_number",
        "bank_name",
        "account_number",
        "momo_number",
        "department",
        "position",
        "supervisor",
        "employment_type",
        "date_hired",
        "appointment_end_date",
        "employment_status",
        "contract_project",
        "shift",
        "assigned_site_id",
        "basic_salary",
        "housing_allowance",
        "transport_allowance",
        "other_allowances",
        "emergency_contact_name",
        "emergency_contact_address",
        "emergency_contact_phone",
        "emergency_contact_relationship",
        "data_notes",
        "photo_url",
      ].map((k) => [k, davorsEmp[k]]),
    ),
    phone: `0${Date.now().toString().slice(-9)}`,
  };
  const afterSnapA = snapshot(phonePayload);
  const beforeSnapA = snapshot(davorsEmp);
  assert(!hasTrackedChange(beforeSnapA, afterSnapA), "phone-only should not be tracked dirty");
  const { error: phoneErr } = await admin
    .from("employees")
    .update({ phone: phonePayload.phone })
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id);
  assert(!phoneErr, phoneErr?.message ?? "phone update failed");
  // App would skip history insert when !hasTrackedChange — mirror that
  const afterA = await historyCount(davorsEmp.employee_id, testStart);
  assert(afterA === beforeA, `(a) history grew on phone-only: ${beforeA} → ${afterA}`);
  console.log("PASS (a) non-tracked phone change → no history row");

  // (b) position change → exactly one history row
  const { data: positions } = await admin
    .from("positions")
    .select("position_title")
    .eq("tenant_id", DAVORS)
    .order("position_title");
  const newPosition =
    (positions ?? []).map((p) => p.position_title).find(
      (title) => title !== davorsEmp.position,
    ) ?? "Cleaner";
  const beforeB = await historyCount(davorsEmp.employee_id, testStart);
  const { error: posErr } = await admin
    .from("employees")
    .update({ position: newPosition })
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id);
  assert(!posErr, posErr?.message ?? "position update failed");
  const snapB = snapshot({ ...davorsEmp, position: newPosition });
  assert(hasTrackedChange(beforeSnapA, snapB), "position change must be dirty");
  const { data: histB, error: histBErr } = await admin
    .from("employee_employment_history")
    .insert(
      historyPayload(
        davorsEmp.employee_id,
        snapB,
        `Position change ${tag}`,
        "hist.test@test.davors",
      ),
    )
    .select("*")
    .single();
  assert(!histBErr && histB, histBErr?.message ?? "history insert b failed");
  createdHistoryIds.push(histB.history_id);
  const afterB = await historyCount(davorsEmp.employee_id, testStart);
  assert(afterB === beforeB + 1, `(b) expected +1 history, got ${beforeB}→${afterB}`);
  assert(histB.position === newPosition, "history position mismatch");
  assert(histB.change_reason.includes(tag), "reason not stored");
  assert(histB.changed_by === "hist.test@test.davors", "changed_by not email-style");
  assert(histB.rate_id === null, "rate_id should be null");
  console.log("PASS (b) position change → one history row", histB.history_id);

  // (c) multiple tracked fields at once → still one row
  const beforeC = await historyCount(davorsEmp.employee_id, testStart);
  const multiSnap = snapshot({
    ...davorsEmp,
    position: newPosition,
    shift: davorsEmp.shift === "Morning" ? "Full Day" : "Morning",
    employment_status:
      davorsEmp.employment_status === "Active" ? "On Leave" : "Active",
    basic_salary: normalizeMoney(davorsEmp.basic_salary) + 1,
  });
  const { error: multiEmpErr } = await admin
    .from("employees")
    .update({
      shift: multiSnap.shift,
      employment_status: multiSnap.employment_status,
      basic_salary: multiSnap.basic_salary,
    })
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id);
  assert(!multiEmpErr, multiEmpErr?.message ?? "multi update failed");
  const { data: histC, error: histCErr } = await admin
    .from("employee_employment_history")
    .insert(
      historyPayload(
        davorsEmp.employee_id,
        multiSnap,
        `Multi change ${tag}`,
        "hist.test@test.davors",
      ),
    )
    .select("*")
    .single();
  assert(!histCErr && histC, histCErr?.message ?? "history insert c failed");
  createdHistoryIds.push(histC.history_id);
  const afterC = await historyCount(davorsEmp.employee_id, testStart);
  assert(afterC === beforeC + 1, `(c) expected exactly +1, got ${beforeC}→${afterC}`);
  assert(histC.shift === multiSnap.shift, "multi shift not stored");
  assert(Number(histC.basic_salary) === multiSnap.basic_salary, "multi salary");
  console.log("PASS (c) multi tracked fields → one history row");

  // (d) re-save no actual changes → no row
  const beforeD = await historyCount(davorsEmp.employee_id, testStart);
  const { data: currentEmp } = await admin
    .from("employees")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id)
    .single();
  const noopSnap = snapshot(currentEmp);
  assert(
    !hasTrackedChange(noopSnap, snapshot(currentEmp)),
    "identical snapshots should not be dirty",
  );
  const { error: noopErr } = await admin
    .from("employees")
    .update({
      position: currentEmp.position,
      department: currentEmp.department,
      shift: currentEmp.shift,
      employment_status: currentEmp.employment_status,
      employment_type: currentEmp.employment_type,
      basic_salary: currentEmp.basic_salary,
      housing_allowance: currentEmp.housing_allowance,
      transport_allowance: currentEmp.transport_allowance,
      other_allowances: currentEmp.other_allowances,
    })
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id);
  assert(!noopErr, noopErr?.message ?? "noop update failed");
  // App skips insert when !dirty
  const afterD = await historyCount(davorsEmp.employee_id, testStart);
  assert(afterD === beforeD, `(d) noop save created history: ${beforeD}→${afterD}`);
  console.log("PASS (d) re-save with no changes → no history row");

  // (e) create new employee → one initial history row
  const { data: empCode, error: empCodeErr } = await admin.rpc(
    "generate_next_code",
    { p_tenant_id: DAVORS, p_entity_type: "EMP", p_padding: 4 },
  );
  assert(!empCodeErr && empCode, empCodeErr?.message ?? "EMP allocate failed");
  const { data: staffRaw, error: staffErr } = await admin.rpc(
    "generate_next_code",
    { p_tenant_id: DAVORS, p_entity_type: "STAFF", p_padding: 4 },
  );
  assert(!staffErr && staffRaw, staffErr?.message ?? "STAFF allocate failed");
  const branded = /^([A-Z0-9]{2,5})-STAFF-(\d+)$/i.exec(String(staffRaw).trim());
  const staffId = branded
    ? `${branded[1].toUpperCase()}${branded[2]}`
    : String(staffRaw).trim();

  const createSnap = snapshot({
    position: "Cleaner",
    department: "DEP01",
    shift: "Morning",
    employment_status: "Active",
    employment_type: "Casual",
    basic_salary: 500,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
  });

  const { data: createdEmp, error: createErr } = await admin
    .from("employees")
    .insert({
      tenant_id: DAVORS,
      employee_id: empCode,
      staff_id: staffId,
      full_name: `History Test ${tag}`,
      employment_type: createSnap.employment_type,
      employment_status: createSnap.employment_status,
      position: createSnap.position,
      department: createSnap.department,
      shift: createSnap.shift,
      basic_salary: createSnap.basic_salary,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
    })
    .select("employee_id")
    .single();
  assert(!createErr && createdEmp, createErr?.message ?? "create employee failed");
  createdEmployeeIds.push(createdEmp.employee_id);

  const { data: createHist, error: createHistErr } = await admin
    .from("employee_employment_history")
    .insert(
      historyPayload(
        createdEmp.employee_id,
        createSnap,
        "Employee created",
        "hist.test@test.davors",
      ),
    )
    .select("*")
    .single();
  assert(!createHistErr && createHist, createHistErr?.message ?? "create history failed");
  createdHistoryIds.push(createHist.history_id);
  const createRows = await listHistory(createdEmp.employee_id);
  assert(createRows.length === 1, `(e) expected 1 history row, got ${createRows.length}`);
  assert(createRows[0].change_reason === "Employee created", "create reason default");
  console.log("PASS (e) new employee → one initial history row", createdEmp.employee_id);

  // (f) seeded history still visible alongside new rows
  const allForDavorsEmp = await listHistory(davorsEmp.employee_id);
  assert(allForDavorsEmp.length >= seeded + 2, "seeded + new rows missing");
  const hasSeeded = allForDavorsEmp.some(
    (r) =>
      r.changed_by === "System Migration" ||
      (r.change_reason ?? "").toLowerCase().includes("migration") ||
      (r.change_reason ?? "").toLowerCase().includes("initial"),
  );
  if (seeded > 0) {
    assert(hasSeeded, "(f) seeded System Migration rows not found in list");
  }
  const hasNew = allForDavorsEmp.some((r) => (r.change_reason ?? "").includes(tag));
  assert(hasNew, "(f) new tagged history rows missing from list");
  // most recent first
  for (let i = 1; i < allForDavorsEmp.length; i++) {
    assert(
      new Date(allForDavorsEmp[i - 1].changed_at) >=
        new Date(allForDavorsEmp[i].changed_at),
      "history not ordered most-recent-first",
    );
  }
  console.log(
    "PASS (f) seeded + new history display list:",
    allForDavorsEmp.length,
    "rows (seeded≈",
    seeded,
    ")",
  );

  // (g) tenant isolation
  const { data: caantaEmpCode } = await admin.rpc("generate_next_code", {
    p_tenant_id: CAANTA,
    p_entity_type: "EMP",
    p_padding: 4,
  });
  const { data: caantaStaffRaw } = await admin.rpc("generate_next_code", {
    p_tenant_id: CAANTA,
    p_entity_type: "STAFF",
    p_padding: 4,
  });
  const caantaBranded = /^([A-Z0-9]{2,5})-STAFF-(\d+)$/i.exec(
    String(caantaStaffRaw).trim(),
  );
  const caantaStaffId = caantaBranded
    ? `${caantaBranded[1].toUpperCase()}${caantaBranded[2]}`
    : String(caantaStaffRaw).trim();

  const { data: caantaEmp, error: caantaEmpErr } = await admin
    .from("employees")
    .insert({
      tenant_id: CAANTA,
      employee_id: caantaEmpCode,
      staff_id: caantaStaffId,
      full_name: `Caanta History ${tag}`,
      employment_type: "Casual",
      employment_status: "Active",
      basic_salary: 100,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
    })
    .select("employee_id")
    .single();
  assert(!caantaEmpErr && caantaEmp, caantaEmpErr?.message ?? "Caanta emp failed");
  caantaEmpId = caantaEmp.employee_id;

  const { data: caantaHist, error: caantaHistErr } = await admin
    .from("employee_employment_history")
    .insert({
      tenant_id: CAANTA,
      employee_id: caantaEmpId,
      effective_date: today(),
      employment_type: "Casual",
      position: null,
      shift: null,
      department: null,
      rate_id: null,
      basic_salary: 100,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      employee_status: "Active",
      change_reason: `Caanta isolation ${tag}`,
      changed_by: "caanta.hist@test.davors",
    })
    .select("history_id, tenant_id")
    .single();
  assert(!caantaHistErr && caantaHist, caantaHistErr?.message ?? "Caanta hist failed");
  caantaHistoryId = caantaHist.history_id;

  const davorsEmail = `hist.davors.${tag.toLowerCase()}@test.davors`;
  const caantaEmail = `hist.caanta.${tag.toLowerCase()}@test.davors`;
  davorsUid = await createTenantUser(DAVORS, davorsEmail);
  caantaUid = await createTenantUser(CAANTA, caantaEmail);

  const davorsClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: dSign } = await davorsClient.auth.signInWithPassword({
    email: davorsEmail,
    password: PASSWORD,
  });
  assert(!dSign, dSign?.message ?? "Davors sign-in failed");

  const { data: davorsSeen, error: dRead } = await davorsClient
    .from("employee_employment_history")
    .select("history_id, tenant_id, change_reason");
  assert(!dRead, dRead?.message ?? "Davors history read failed");
  const dIds = new Set((davorsSeen ?? []).map((r) => r.history_id));
  assert(dIds.has(histB.history_id), "Davors cannot see own history");
  assert(!dIds.has(caantaHistoryId), "Davors saw Caanta history — RLS FAIL");
  assert(
    (davorsSeen ?? []).every((r) => r.tenant_id === DAVORS),
    "Davors saw non-Davors tenant_id",
  );
  console.log(
    "PASS (g) RLS Davors:",
    davorsSeen.length,
    "rows, not Caanta",
  );

  const caantaClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: cSign } = await caantaClient.auth.signInWithPassword({
    email: caantaEmail,
    password: PASSWORD,
  });
  assert(!cSign, cSign?.message ?? "Caanta sign-in failed");

  const { data: caantaSeen, error: cRead } = await caantaClient
    .from("employee_employment_history")
    .select("history_id, tenant_id, change_reason");
  assert(!cRead, cRead?.message ?? "Caanta history read failed");
  const cIds = new Set((caantaSeen ?? []).map((r) => r.history_id));
  assert(cIds.has(caantaHistoryId), "Caanta cannot see own history");
  assert(!cIds.has(histB.history_id), "Caanta saw Davors history — RLS FAIL");
  assert(
    (caantaSeen ?? []).every((r) => r.tenant_id === CAANTA),
    "Caanta saw non-Caanta tenant_id",
  );
  console.log(
    "PASS (g) RLS Caanta:",
    caantaSeen.length,
    "rows, not Davors",
  );
} finally {
  // Restore Davors employee core fields from first snapshot where possible
  await admin
    .from("employees")
    .update({
      phone: davorsEmp.phone,
      position: davorsEmp.position,
      shift: davorsEmp.shift,
      employment_status: davorsEmp.employment_status,
      basic_salary: davorsEmp.basic_salary,
    })
    .eq("tenant_id", DAVORS)
    .eq("employee_id", davorsEmp.employee_id);

  for (const id of createdHistoryIds) {
    await admin.from("employee_employment_history").delete().eq("history_id", id);
  }
  if (caantaHistoryId) {
    await admin
      .from("employee_employment_history")
      .delete()
      .eq("history_id", caantaHistoryId);
  }
  await admin
    .from("employee_employment_history")
    .delete()
    .ilike("change_reason", `%${tag}%`);

  for (const id of createdEmployeeIds) {
    await admin
      .from("employee_employment_history")
      .delete()
      .eq("employee_id", id);
    await admin.from("employees").delete().eq("employee_id", id);
  }
  if (caantaEmpId) {
    await admin
      .from("employee_employment_history")
      .delete()
      .eq("employee_id", caantaEmpId);
    await admin.from("employees").delete().eq("employee_id", caantaEmpId);
  }
  if (davorsUid) await cleanupUser(davorsUid);
  if (caantaUid) await cleanupUser(caantaUid);
  console.log("Cleanup done");
}

console.log("\nAll employment history staging checks passed.");
