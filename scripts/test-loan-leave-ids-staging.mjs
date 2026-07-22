/**
 * Staging: LOAN / LEAVE generate_next_code wiring for HR registers.
 * Usage: node scripts/test-loan-leave-ids-staging.mjs
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

const checks = [
  [
    "app/dashboard/hr-payroll/loan-register.tsx",
    "allocateLoanId",
    "generateNextSequentialId",
  ],
  [
    "app/dashboard/hr-payroll/leave-management.tsx",
    "allocateLeaveId",
    "generateNextSequentialId",
  ],
];

for (const [file, fn, banned] of checks) {
  const source = readFileSync(resolve(file), "utf8");
  assert(source.includes(fn), `${file} missing ${fn}`);
  assert(!source.includes(banned), `${file} still references ${banned}`);
}

const apiSource = readFileSync(
  resolve("app/dashboard/hr-payroll/hr-ids-api.ts"),
  "utf8",
);
assert(apiSource.includes('"LOAN"'), "hr-ids-api missing LOAN");
assert(apiSource.includes('"LEAVE"'), "hr-ids-api missing LEAVE");

const utilsSource = readFileSync(
  resolve("app/dashboard/hr-payroll/hr-register-utils.ts"),
  "utf8",
);
assert(
  !utilsSource.includes("generateNextSequentialId"),
  "hr-register-utils still exports generateNextSequentialId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function snapshot() {
  const [
    { data: loans, error: loanError },
    { data: leaves, error: leaveError },
  ] = await Promise.all([
    supabase
      .from("loan_register")
      .select("loan_id, employee_id, tenant_id")
      .order("loan_id"),
    supabase
      .from("leave_management")
      .select("leave_id, employee_id, tenant_id")
      .order("leave_id"),
  ]);
  if (loanError || leaveError) {
    throw new Error(loanError?.message ?? leaveError?.message);
  }
  return { loans: loans ?? [], leaves: leaves ?? [] };
}

const before = await snapshot();
console.log("Before counts:", {
  loans: before.loans.length,
  leaves: before.leaves.length,
});
console.log(
  "Existing loan IDs:",
  before.loans.map((r) => r.loan_id),
);
console.log(
  "Existing leave IDs:",
  before.leaves.map((r) => r.leave_id),
);

const { data: employee, error: empError } = await supabase
  .from("employees")
  .select("employee_id, tenant_id")
  .eq("tenant_id", DAVORS)
  .limit(1)
  .maybeSingle();
if (empError) throw new Error(empError.message);
assert(employee?.employee_id, "No Davors employee available for insert test");
console.log("Using employee:", employee.employee_id);

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

const tag = `HRID-${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

const loanId = await allocate("LOAN");
const leaveId = await allocate("LEAVE");
console.log("Allocated:", { loanId, leaveId });

const { data: loanRow, error: loanInsertError } = await supabase
  .from("loan_register")
  .insert({
    tenant_id: DAVORS,
    loan_id: loanId,
    employee_id: employee.employee_id,
    loan_amount: 100,
    date_issued: today,
    repayment_period_months: 2,
    monthly_deduction: 50,
    total_repaid_to_date: 0,
    outstanding_balance: 100,
  })
  .select("loan_id")
  .single();
if (loanInsertError) throw new Error(`LOAN insert: ${loanInsertError.message}`);

const { data: leaveRow, error: leaveInsertError } = await supabase
  .from("leave_management")
  .insert({
    tenant_id: DAVORS,
    leave_id: leaveId,
    employee_id: employee.employee_id,
    leave_type: "Annual Leave",
    start_date: today,
    end_date: today,
    days_requested: 1,
    approval_status: "Pending",
  })
  .select("leave_id")
  .single();
if (leaveInsertError) {
  throw new Error(`LEAVE insert: ${leaveInsertError.message}`);
}

console.log("Created:", {
  loan: loanRow.loan_id,
  leave: leaveRow.leave_id,
  note: tag,
});

assert(loanRow.loan_id === loanId, "LOAN id mismatch");
assert(leaveRow.leave_id === leaveId, "LEAVE id mismatch");

const after = await snapshot();

for (const prior of before.loans) {
  const still = after.loans.find((r) => r.loan_id === prior.loan_id);
  assert(still, `Missing prior loan ${prior.loan_id}`);
}
for (const prior of before.leaves) {
  const still = after.leaves.find((r) => r.leave_id === prior.leave_id);
  assert(still, `Missing prior leave ${prior.leave_id}`);
}

await supabase.from("loan_register").delete().eq("loan_id", loanId);
await supabase.from("leave_management").delete().eq("leave_id", leaveId);

const cleaned = await snapshot();
assert(
  cleaned.loans.length === before.loans.length,
  "Loan count should restore after cleanup",
);
assert(
  cleaned.leaves.length === before.leaves.length,
  "Leave count should restore after cleanup",
);

console.log("ALL CHECKS PASSED");
