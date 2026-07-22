/**
 * Staging verify: checklist_id backfill + CHECKLIST allocate-on-save wiring.
 * Usage: node scripts/test-checklist-id-staging.mjs
 *
 * Assumes 106_backfill_checklist_ids.sql has already been applied.
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

const uiSource = readFileSync(
  resolve("app/dashboard/operations/inspection-summary.tsx"),
  "utf8",
);
assert(
  uiSource.includes("allocateChecklistId"),
  "inspection-summary.tsx missing allocateChecklistId",
);
assert(
  uiSource.includes('editingId ? ('),
  "inspection-summary.tsx should hide Checklist ID on create",
);

const apiSource = readFileSync(
  resolve("app/dashboard/operations/operations-ids-api.ts"),
  "utf8",
);
assert(
  apiSource.includes('CHECKLIST_ENTITY_TYPE = "CHECKLIST"'),
  "operations-ids-api missing CHECKLIST entity type",
);
assert(
  apiSource.includes("allocateChecklistId"),
  "operations-ids-api missing allocateChecklistId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: inspections, error: inspError } = await supabase
  .from("inspection_summary")
  .select("checklist_id, tenant_id, inspection_date")
  .eq("tenant_id", DAVORS)
  .order("inspection_date", { ascending: true })
  .order("checklist_id", { ascending: true });
if (inspError) throw new Error(inspError.message);

console.log("Davors inspections:", inspections);
assert((inspections?.length ?? 0) >= 1, "Expected at least one inspection");

const branded = /^DF-CHECKLIST-\d{4}$/;
for (const row of inspections) {
  assert(
    branded.test(row.checklist_id),
    `Expected branded checklist_id, got ${row.checklist_id}`,
  );
}

const { data: seqRows, error: seqError } = await supabase
  .from("id_sequences")
  .select("tenant_id, entity_type, next_value")
  .eq("tenant_id", DAVORS)
  .eq("entity_type", "CHECKLIST")
  .maybeSingle();
if (seqError) throw new Error(seqError.message);
assert(seqRows, "Missing id_sequences row for CHECKLIST");
console.log("CHECKLIST sequence:", seqRows);

const maxSuffix = Math.max(
  ...inspections.map((r) => Number(r.checklist_id.split("-").pop())),
);
assert(
  seqRows.next_value >= maxSuffix,
  `Sequence ${seqRows.next_value} should be >= max backfilled ${maxSuffix}`,
);

// FK integrity: every failed_inspections.checklist_id (when set) must exist
const { data: failed, error: failedError } = await supabase
  .from("failed_inspections")
  .select("issue_no, checklist_id")
  .eq("tenant_id", DAVORS);
if (failedError) throw new Error(failedError.message);

const inspectionIds = new Set(inspections.map((r) => r.checklist_id));
const { data: allInspections, error: allInspError } = await supabase
  .from("inspection_summary")
  .select("checklist_id");
if (allInspError) throw new Error(allInspError.message);
const allIds = new Set((allInspections ?? []).map((r) => r.checklist_id));

for (const row of failed ?? []) {
  if (row.checklist_id) {
    assert(
      allIds.has(row.checklist_id),
      `failed_inspections ${row.issue_no} points to missing ${row.checklist_id}`,
    );
  }
}
console.log(
  `FK check OK (${(failed ?? []).filter((r) => r.checklist_id).length} linked failed_inspections)`,
);

// Soft refs on work_orders
const { data: wos, error: woError } = await supabase
  .from("work_orders")
  .select("work_order_no, checklist_id")
  .eq("tenant_id", DAVORS)
  .not("checklist_id", "is", null);
if (woError) throw new Error(woError.message);
for (const row of wos ?? []) {
  assert(
    allIds.has(row.checklist_id),
    `work_orders ${row.work_order_no} soft-ref missing ${row.checklist_id}`,
  );
}
console.log(`Soft-ref check OK (${(wos ?? []).length} work_orders with checklist_id)`);

// Allocate next + insert a throwaway inspection, then delete it
const { data: nextCode, error: allocError } = await supabase.rpc(
  "generate_next_code",
  {
    p_tenant_id: DAVORS,
    p_entity_type: "CHECKLIST",
    p_padding: 4,
  },
);
if (allocError || !nextCode) {
  throw new Error(allocError?.message ?? "empty allocate");
}
console.log("Allocated next:", nextCode);
assert(branded.test(nextCode), `Unexpected next code ${nextCode}`);
assert(
  Number(nextCode.split("-").pop()) === maxSuffix + 1,
  `Expected next suffix ${maxSuffix + 1}, got ${nextCode}`,
);
assert(!inspectionIds.has(nextCode), `Collided with existing ${nextCode}`);

const today = new Date().toISOString().slice(0, 10);
const tag = `CHKTEST-${Date.now().toString(36).toUpperCase()}`;

const { error: insertError } = await supabase.from("inspection_summary").insert({
  tenant_id: DAVORS,
  checklist_id: nextCode,
  inspection_date: today,
  critical_findings: tag,
  status: "Good",
  pass_fail: "Pass",
});
if (insertError) throw new Error(`insert failed: ${insertError.message}`);
console.log("Inserted test inspection:", nextCode);

const { error: deleteError } = await supabase
  .from("inspection_summary")
  .delete()
  .eq("checklist_id", nextCode);
if (deleteError) throw new Error(`cleanup failed: ${deleteError.message}`);
console.log("Cleaned up test inspection.");

// Note: sequence was consumed; leave it advanced (correct production behavior).
console.log("ALL CHECKS PASSED");
