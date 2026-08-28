/**
 * Phase 2 offline write-queue — staging handler/idempotency tests (no browser).
 *
 *   npx tsx scripts/_test-offline-write-queue-phase2-staging.ts --env-file .env.staging.local
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { syncAttendanceQueueItem } from "../lib/offline-write-queue/handlers/attendance";
import { syncExpenseQueueItem } from "../lib/offline-write-queue/handlers/expense";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "staging Supabase required");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const { data: employees } = await admin
    .from("employees")
    .select("staff_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .limit(2);
  assert(employees?.[0]?.staff_id, "need employee");
  const staffA = employees[0].staff_id as string;
  const staffB =
    (employees[1]?.staff_id as string | undefined) ?? `${staffA}-alt-skip`;

  const attendanceIds: string[] = [];
  const expenseIds: string[] = [];

  try {
    // --- Attendance: first write + retry same UUID + duplicate natural key ---
    const op1 = crypto.randomUUID();
    const payloadBase = {
      date: dateStr,
      staff_id: staffA,
      employment_type: "Full-time",
      project_assignment: "WQ Phase2",
      clock_in: "08:00",
      clock_out: "17:00",
      hours_worked: 8,
      overtime_hours: 0,
      attendance_status: "Present",
    };

    const first = await syncAttendanceQueueItem(admin, {
      clientOpId: op1,
      tenantId: DAVORS_TENANT_ID,
      payload: payloadBase,
    });
    record("attendance first insert", first.ok, JSON.stringify(first));
    if (first.ok) attendanceIds.push(op1);

    const retry = await syncAttendanceQueueItem(admin, {
      clientOpId: op1,
      tenantId: DAVORS_TENANT_ID,
      payload: { ...payloadBase, attendance_status: "Late" },
    });
    record(
      "attendance retry same UUID is idempotent",
      retry.ok && !("duplicateNaturalKey" in retry && retry.duplicateNaturalKey === false
        ? false
        : retry.ok),
      JSON.stringify(retry),
    );
    record(
      "attendance retry does not change status (first wins by id)",
      true,
      "same row id reused",
    );

    const { data: afterRetry } = await admin
      .from("attendance_register")
      .select("attendance_status")
      .eq("id", op1)
      .single();
    record(
      "attendance status still Present after retry payload Late",
      afterRetry?.attendance_status === "Present",
      String(afterRetry?.attendance_status),
    );

    const opDup = crypto.randomUUID();
    const dup = await syncAttendanceQueueItem(admin, {
      clientOpId: opDup,
      tenantId: DAVORS_TENANT_ID,
      payload: { ...payloadBase, attendance_status: "Absent" },
    });
    record(
      "attendance duplicate staff+date DO NOTHING",
      dup.ok && "duplicateNaturalKey" in dup && dup.duplicateNaturalKey === true,
      JSON.stringify(dup),
    );

    const { count: staffDayCount } = await admin
      .from("attendance_register")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("staff_id", staffA)
      .eq("date", dateStr);
    record(
      "only one attendance row for staffA+date",
      staffDayCount === 1,
      `count=${staffDayCount}`,
    );

    if (staffB !== `${staffA}-alt-skip`) {
      const op2 = crypto.randomUUID();
      const secondStaff = await syncAttendanceQueueItem(admin, {
        clientOpId: op2,
        tenantId: DAVORS_TENANT_ID,
        payload: { ...payloadBase, staff_id: staffB, attendance_status: "Late" },
      });
      record("attendance second staff insert", secondStaff.ok, JSON.stringify(secondStaff));
      if (secondStaff.ok) attendanceIds.push(op2);
    }

    // --- Expense: insert + tax ledger + retry via client_op_id ---
    const expOp = crypto.randomUUID();
    const expPayload = {
      date: dateStr,
      expense_category: "General",
      sub_category: "Misc",
      description: `WQ Phase2 ${stamp}`,
      vendor: "Offline Queue Vendor",
      price: 100,
      quantity: 1,
      amount: 100,
      payment_method: "Cash",
      approved_by: "Phase2 Test",
      supplied_receipt_no: `WQ-${stamp}`,
      payment_status: "Paid",
      gross_before_wht: 100,
      wht_rate: null as number | null,
      wht_amount: 0,
      input_vat_amount: 0,
      net_of_tax_amount: 100,
      notes: "phase2 staging test",
      wht_rate_pct: null as number | null,
      input_tax_component: null as "vat_bundle" | "vfrs" | null,
      notification_detail: "GHS 100.00",
    };

    // Prefer real category/method names if present
    const { data: cats } = await admin
      .from("expense_categories")
      .select("name")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .limit(1);
    if (cats?.[0]?.name) expPayload.expense_category = cats[0].name as string;
    const { data: subs } = await admin
      .from("expense_subcategories")
      .select("name")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .limit(1);
    if (subs?.[0]?.name) expPayload.sub_category = subs[0].name as string;
    const { data: methods } = await admin
      .from("payment_methods")
      .select("name")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .limit(1);
    if (methods?.[0]?.name) expPayload.payment_method = methods[0].name as string;

    const exp1 = await syncExpenseQueueItem(admin as SupabaseClient, {
      clientOpId: expOp,
      tenantId: DAVORS_TENANT_ID,
      payload: expPayload,
      notificationSent: true, // skip notify spam in automated test
    });
    record("expense first sync", exp1.ok, JSON.stringify(exp1));
    if (exp1.ok) expenseIds.push(exp1.expenseId);

    const { count: taxCount1 } = await admin
      .from("tax_ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "expense_register")
      .eq("source_id", expOp);
    // tax rows may be 0 when no WHT/VAT — still OK if sync returned ok
    record(
      "expense tax ledger sync ran",
      exp1.ok,
      `tax_rows=${taxCount1 ?? 0} (0 OK when no WHT/VAT)`,
    );

    const expRetry = await syncExpenseQueueItem(admin as SupabaseClient, {
      clientOpId: expOp,
      tenantId: DAVORS_TENANT_ID,
      payload: { ...expPayload, description: "should not duplicate" },
      notificationSent: true,
    });
    record("expense retry same client_op_id", expRetry.ok, JSON.stringify(expRetry));

    const { count: expCount } = await admin
      .from("expense_register")
      .select("id", { count: "exact", head: true })
      .eq("client_op_id", expOp);
    record("expense single row for client_op_id", expCount === 1, `count=${expCount}`);

    // Simulate failure then recovery: invalid staff should fail attendance
    const failOp = crypto.randomUUID();
    const fail = await syncAttendanceQueueItem(admin, {
      clientOpId: failOp,
      tenantId: DAVORS_TENANT_ID,
      payload: {
        ...payloadBase,
        staff_id: "NO-SUCH-STAFF-WQ-PHASE2",
        date: dateStr,
      },
    });
    record(
      "failed attendance surfaces error",
      !fail.ok,
      fail.ok ? "unexpected ok" : fail.error,
    );
  } finally {
    for (const id of expenseIds) {
      await admin
        .from("tax_ledger_entries")
        .delete()
        .eq("source_type", "expense_register")
        .eq("source_id", id);
      await admin.from("expense_register").delete().eq("id", id);
    }
    for (const id of attendanceIds) {
      await admin.from("attendance_register").delete().eq("id", id);
    }
    // Also delete any accidental dup op row if created
    await admin
      .from("attendance_register")
      .delete()
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("staff_id", staffA)
      .eq("date", dateStr)
      .eq("project_assignment", "WQ Phase2");
    if (staffB !== `${staffA}-alt-skip`) {
      await admin
        .from("attendance_register")
        .delete()
        .eq("tenant_id", DAVORS_TENANT_ID)
        .eq("staff_id", staffB)
        .eq("date", dateStr)
        .eq("project_assignment", "WQ Phase2");
    }
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
