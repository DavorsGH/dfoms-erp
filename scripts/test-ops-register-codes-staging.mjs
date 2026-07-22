/**
 * Staging: WO/CMP/CA/ISS/INC generate_next_code wiring for operations registers.
 * Usage: node scripts/test-ops-register-codes-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const files = [
  ["app/dashboard/operations/work-orders.tsx", "allocateWorkOrderNo"],
  ["app/dashboard/operations/complaint-register.tsx", "allocateComplaintNo"],
  ["app/dashboard/operations/corrective-actions.tsx", "allocateCorrectiveActionNo"],
  ["app/dashboard/operations/failed-inspections.tsx", "allocateFailedInspectionIssueNo"],
  ["app/dashboard/operations/incident-register.tsx", "allocateIncidentNo"],
];

for (const [file, fn] of files) {
  const source = readFileSync(resolve(file), "utf8");
  assert(source.includes(fn), `${file} missing ${fn}`);
  assert(
    !source.includes("generateNextOperationsId"),
    `${file} still references generateNextOperationsId`,
  );
}

const apiSource = readFileSync(
  resolve("app/dashboard/operations/operations-ids-api.ts"),
  "utf8",
);
for (const entity of ["WO", "CMP", "CA", "ISS", "INC"]) {
  assert(apiSource.includes(`"${entity}"`), `operations-ids-api missing ${entity}`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function snapshot(table, pkCol) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("tenant_id", DAVORS)
    .order(pkCol);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row }));
}

const before = {
  work_orders: await snapshot("work_orders", "work_order_no"),
  complaint_register: await snapshot("complaint_register", "complaint_no"),
  corrective_actions: await snapshot("corrective_actions", "action_no"),
  failed_inspections: await snapshot("failed_inspections", "issue_no"),
  incident_register: await snapshot("incident_register", "incident_no"),
};

console.log("Before counts:", {
  work_orders: before.work_orders.length,
  complaint_register: before.complaint_register.length,
  corrective_actions: before.corrective_actions.length,
  failed_inspections: before.failed_inspections.length,
  incident_register: before.incident_register.length,
});

async function allocate(entity) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: DAVORS,
    p_entity_type: entity,
    p_padding: 4,
  });
  if (error || !data) throw new Error(`${entity}: ${error?.message ?? "empty"}`);
  const expected = new RegExp(`^DF-${entity}-\\d{4}$`);
  assert(expected.test(data), `Expected DF-${entity}-####, got ${data}`);
  return data;
}

const tag = `OPSID-${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

const codes = {
  WO: await allocate("WO"),
  CMP: await allocate("CMP"),
  CA: await allocate("CA"),
  ISS: await allocate("ISS"),
  INC: await allocate("INC"),
};
console.log("Allocated:", codes);

const inserts = [
  {
    table: "work_orders",
    payload: {
      tenant_id: DAVORS,
      work_order_no: codes.WO,
      date: today,
      remarks: `${tag} WO`,
    },
    pk: "work_order_no",
  },
  {
    table: "complaint_register",
    payload: {
      tenant_id: DAVORS,
      complaint_no: codes.CMP,
      date_received: today,
      notes: `${tag} CMP`,
    },
    pk: "complaint_no",
  },
  {
    table: "corrective_actions",
    payload: {
      tenant_id: DAVORS,
      action_no: codes.CA,
      date_raised: today,
      related_work_order: null,
      related_issue_no: null,
      notes: `${tag} CA`,
    },
    pk: "action_no",
  },
  {
    table: "failed_inspections",
    payload: {
      tenant_id: DAVORS,
      issue_no: codes.ISS,
      date_identified: today,
      problem_description: `${tag} ISS`,
    },
    pk: "issue_no",
  },
  {
    table: "incident_register",
    payload: {
      tenant_id: DAVORS,
      incident_no: codes.INC,
      date: today,
      notes: `${tag} INC`,
    },
    pk: "incident_no",
  },
];

const created = {};
for (const item of inserts) {
  const { data, error } = await supabase
    .from(item.table)
    .insert(item.payload)
    .select("*")
    .single();
  if (error) throw new Error(`${item.table} insert: ${error.message}`);
  created[item.table] = data;
  console.log(`Inserted ${item.table}:`, data[item.pk]);
}

// Confirm CA can reference an existing WO / ISS without changing those PKs
const { error: caLinkError } = await supabase
  .from("corrective_actions")
  .update({
    related_work_order: codes.WO,
    related_issue_no: codes.ISS,
  })
  .eq("tenant_id", DAVORS)
  .eq("action_no", codes.CA);
if (caLinkError) throw new Error(`CA cross-ref update: ${caLinkError.message}`);

const { data: linkedCa, error: linkedErr } = await supabase
  .from("corrective_actions")
  .select("action_no, related_work_order, related_issue_no")
  .eq("tenant_id", DAVORS)
  .eq("action_no", codes.CA)
  .single();
if (linkedErr) throw new Error(linkedErr.message);
assert(linkedCa.related_work_order === codes.WO, "CA related_work_order mismatch");
assert(linkedCa.related_issue_no === codes.ISS, "CA related_issue_no mismatch");
console.log("CA cross-refs OK:", linkedCa);

const after = {
  work_orders: await snapshot("work_orders", "work_order_no"),
  complaint_register: await snapshot("complaint_register", "complaint_no"),
  corrective_actions: await snapshot("corrective_actions", "action_no"),
  failed_inspections: await snapshot("failed_inspections", "issue_no"),
  incident_register: await snapshot("incident_register", "incident_no"),
};

function assertPriorsUnchanged(table, pkCol, ignoreKeys = []) {
  for (const prior of before[table]) {
    const match = after[table].find((row) => row[pkCol] === prior[pkCol]);
    assert(match, `Missing prior ${table} ${prior[pkCol]}`);
    for (const [key, value] of Object.entries(prior)) {
      if (ignoreKeys.includes(key)) continue;
      assert(
        match[key] === value,
        `Prior ${table}.${prior[pkCol]}.${key} changed`,
      );
    }
  }
}

assertPriorsUnchanged("work_orders", "work_order_no");
assertPriorsUnchanged("complaint_register", "complaint_no");
assertPriorsUnchanged("corrective_actions", "action_no");
assertPriorsUnchanged("failed_inspections", "issue_no");
assertPriorsUnchanged("incident_register", "incident_no");

console.log("SUCCESS:", {
  codes,
  prior_unchanged: {
    work_orders: before.work_orders.length,
    complaint_register: before.complaint_register.length,
    corrective_actions: before.corrective_actions.length,
    failed_inspections: before.failed_inspections.length,
    incident_register: before.incident_register.length,
  },
});
