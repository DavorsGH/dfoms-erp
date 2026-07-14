import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const TEST_PASSWORD = "TestRbac1!";

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks = [];

  const schemaChecks = await admin.rpc("current_user_employee_id");
  checks.push({
    name: "rpc current_user_employee_id exists",
    ok: !schemaChecks.error?.message?.includes("Could not find the function"),
    detail: schemaChecks.error?.message ?? "exists",
  });

  const { data: leaveTypes } = await admin.from("leave_types").select("type_name");
  checks.push({
    name: "leave_types seeded",
    ok: (leaveTypes?.length ?? 0) >= 2,
    detail: JSON.stringify((leaveTypes ?? []).map((row) => row.type_name)),
  });

  const { data: approverConfig } = await admin
    .from("leave_approver_config")
    .select("approver_user_account_id, user_accounts(email, employee_id)")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  checks.push({
    name: "leave approver configured",
    ok: !!approverConfig?.approver_user_account_id,
    detail: JSON.stringify(approverConfig?.user_accounts ?? null),
  });

  const employee = await signIn(url, anonKey, "rbac.employee@test.davors");
  const hr = await signIn(url, anonKey, "rbac.hr@test.davors");

  const { data: employeeAccount } = await admin
    .from("user_accounts")
    .select("employee_id, auth_uid")
    .eq("email", "rbac.employee@test.davors")
    .single();

  const { count: employeePayrollCount } = await employee
    .from("payroll_history")
    .select("id", { count: "exact", head: true });

  const { count: hrPayrollCount } = await hr
    .from("payroll_history")
    .select("id", { count: "exact", head: true });

  checks.push({
    name: "employee payroll_history scoped to own rows",
    ok: (employeePayrollCount ?? 0) <= (hrPayrollCount ?? 0),
    detail: `employee=${employeePayrollCount ?? 0}, hr=${hrPayrollCount ?? 0}`,
  });

  const { data: annualType } = await admin
    .from("leave_types")
    .select("id")
    .eq("type_name", "Annual Leave")
    .single();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 30);
  const start = tomorrow.toISOString().slice(0, 10);
  const endDate = new Date(tomorrow);
  endDate.setDate(endDate.getDate() + 1);
  const end = endDate.toISOString().slice(0, 10);

  const { data: submitId, error: submitError } = await employee.rpc(
    "submit_leave_request",
    {
      p_leave_type_id: annualType?.id,
      p_start_date: start,
      p_end_date: end,
      p_reason: "Phase 3 verification request",
    },
  );

  checks.push({
    name: "employee can submit leave request",
    ok: !submitError && !!submitId,
    detail: submitError?.message ?? String(submitId),
  });

  if (submitId) {
    const { data: submittedRequest } = await admin
      .from("leave_requests")
      .select("approver_user_account_id, status")
      .eq("id", submitId)
      .single();

    checks.push({
      name: "submitted request routes to configured approver",
      ok:
        submittedRequest?.approver_user_account_id ===
        approverConfig?.approver_user_account_id,
      detail: JSON.stringify(submittedRequest),
    });
  }

  const { data: david } = await admin
    .from("user_accounts")
    .select("role, employee_id, is_active")
    .eq("email", "david.avors@gmail.com")
    .single();

  checks.push({
    name: "david unchanged",
    ok:
      david?.role === "super_admin" &&
      david?.employee_id === "EMP0001" &&
      david?.is_active === true,
    detail: JSON.stringify(david),
  });

  console.log(JSON.stringify(checks, null, 2));

  if (checks.some((check) => !check.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
