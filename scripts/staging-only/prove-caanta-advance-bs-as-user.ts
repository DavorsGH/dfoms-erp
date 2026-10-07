/**
 * Caanta salary advance → BS / cash flow proof as authenticated user (not service role for saves).
 *
 * npx tsx scripts/staging-only/prove-caanta-advance-bs-as-user.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import { calculateStaffAdvanceCashOutflowsByMonth } from "../../app/dashboard/finance/staff-advances-balance-sheet-utils";
import type { SalaryAdvanceRegisterEntry } from "../../app/dashboard/hr-payroll/salary-advance-register-utils";
import type { PayrollProcessingRow } from "../../app/dashboard/hr-payroll/payroll-processing-utils";
import { applyRegisterSalaryAdvancesToLockRows } from "./payroll-lock-row-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const FY = 2026;
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

type Snap = {
  receivable: number;
  cash: number;
  bsDiff: number;
  advanceOutflow: number;
  label: string;
};

async function createCaantaHrUser(admin: SupabaseClient) {
  const stamp = Date.now();
  const email = `r1.adv.${stamp}@test.davors`;
  const password = `R1Adv-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: CAANTA,
    role: "super_admin",
    is_active: true,
  });

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  return { client, email };
}

async function sessionCookie(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("No session");
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  return `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

function monthIndexFromIso(dateIso: string): number {
  const m = Number(dateIso.slice(5, 7));
  return m - 1;
}

async function snapshot(
  admin: SupabaseClient,
  buId: string,
  monthIndex: number,
  label: string,
): Promise<Snap> {
  const data = await fetchBalanceSheetPageData(admin, CAANTA, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: buId,
  });
  const report = buildStandardBalanceSheetReport(data, CAANTA, FY);
  const check = getBalanceSheetMonthCheck(report, monthIndex);
  const receivableRow = report.rows.find((r) => r.key === "staff-advances");
  const cashRow = report.rows.find((r) => r.key === "cash");
  const receivable = receivableRow
    ? getBalanceSheetAmountForMonth(receivableRow, monthIndex)
    : 0;
  const cash = cashRow ? getBalanceSheetAmountForMonth(cashRow, monthIndex) : 0;

  const advanceOutflow = calculateStaffAdvanceCashOutflowsByMonth(
    data.initialStaffSalaryAdvanceEntries ?? [],
    FY,
  )[monthIndex];

  return {
    label,
    receivable: Math.round(receivable * 100) / 100,
    cash: Math.round(cash * 100) / 100,
    bsDiff: Math.round(check.difference * 100) / 100,
    advanceOutflow: Math.round(advanceOutflow * 100) / 100,
  };
}

function assertStableBalance(s: Snap, baselineDiff: number) {
  if (Math.abs(s.bsDiff - baselineDiff) >= 0.02) {
    throw new Error(
      `${s.label}: BS check drifted (diff=${s.bsDiff}, baseline diff=${baselineDiff})`,
    );
  }
}

function logSnap(before: Snap | null, after: Snap) {
  const dRec = before ? after.receivable - before.receivable : after.receivable;
  const dCash = before ? after.cash - before.cash : after.cash;
  console.log(
    `${after.label}: receivable=${after.receivable} (${dRec >= 0 ? "+" : ""}${before ? dRec : "base"}), cash=${after.cash} (${dCash >= 0 ? "+" : ""}${before ? dCash : "base"}), advance CF outflow=${after.advanceOutflow}, BS diff=${after.bsDiff}`,
  );
}

async function releasePayrollMonthIfLocked(
  admin: SupabaseClient,
  buId: string,
  payrollMonth: string,
) {
  const { data: emps } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", CAANTA);
  const ids = (emps ?? []).map((e) => e.employee_id);
  await admin.rpc("release_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: buId,
    p_employee_ids: ids,
    p_payroll_month: payrollMonth,
    p_period_year: Number(payrollMonth.slice(0, 4)),
    p_period_month: Number(payrollMonth.slice(5, 7)),
  });
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bu } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", CAANTA)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!bu?.id) throw new Error("No Caanta BU");

  const deductMonth = "2026-06-01";
  const issueDate = "2026-06-20";
  await releasePayrollMonthIfLocked(admin, bu.id, deductMonth);

  const { data: employees } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", CAANTA)
    .limit(2);
  if (!employees || employees.length < 2) {
    throw new Error("Need at least 2 Caanta employees for advance proof");
  }

  let payAccountId: string | null = null;
  const { data: existingPay } = await admin
    .from("payment_accounts")
    .select("id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  payAccountId = existingPay?.id ?? null;
  if (!payAccountId) {
    const { data: seeded, error: seedPayErr } = await admin
      .from("payment_accounts")
      .insert({
        tenant_id: CAANTA,
        account_name: "Release 1 staging cash",
        is_active: true,
      })
      .select("id")
      .single();
    if (seedPayErr || !seeded?.id) {
      throw seedPayErr ?? new Error("Could not seed Caanta payment account");
    }
    payAccountId = seeded.id;
    console.log("Seeded Caanta payment account for staging proof.");
  }

  const monthIndex = monthIndexFromIso(issueDate);

  const { client: userClient } = await createCaantaHrUser(admin);
  console.log("Authenticated Caanta HR user created and signed in (anon key).");

  const base = await snapshot(admin, bu.id, monthIndex, "baseline");
  logSnap(null, base);
  const baselineBsDiff = base.bsDiff;
  console.log(`Note: Caanta baseline BS difference (pre-existing) = ${baselineBsDiff}`);
  assertStableBalance(base, baselineBsDiff);

  const { data: saveResult, error: saveErr } = await userClient.rpc(
    "save_salary_advances_bulk",
    {
      p_payload: {
        tenant_id: CAANTA,
        business_unit_id: bu.id,
        advances: employees.map((e) => ({
          employee_id: e.employee_id,
          amount: 100,
          date_issued: issueDate,
          deduct_payroll_month: deductMonth,
          payment_account_id: payAccountId,
          approved_by: "Release 1 proof",
        })),
      },
    },
  );
  if (saveErr) throw saveErr;
  const advanceIds: string[] = (saveResult as { advanceIds?: string[] })?.advanceIds ?? [];
  if (advanceIds.length !== 2) {
    throw new Error(`Expected 2 advances, got ${advanceIds.length}`);
  }

  const afterSave = await snapshot(admin, bu.id, monthIndex, "after 2×GHS100 save");
  logSnap(base, afterSave);
  assertStableBalance(afterSave, baselineBsDiff);
  const dRec = afterSave.receivable - base.receivable;
  const dCash = afterSave.cash - base.cash;
  if (Math.abs(dRec - 200) > 0.05 || Math.abs(dCash + 200) > 0.05) {
    throw new Error(
      `Expected receivable +200 and cash -200; got Δrec=${dRec} Δcash=${dCash}`,
    );
  }
  if (Math.abs(afterSave.advanceOutflow - base.advanceOutflow - 200) > 0.05) {
    throw new Error("Cash flow staff-advance outflow did not increase by 200");
  }

  const employeeIds = employees.map((e) => e.employee_id);
  for (const employeeId of employeeIds) {
    const { data: existing } = await admin
      .from("payroll_processing")
      .select("id")
      .eq("payroll_month", deductMonth)
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (existing?.id) {
      continue;
    }
    const { error: seedProcErr } = await admin.from("payroll_processing").insert({
      payroll_month: deductMonth,
      employee_id: employeeId,
      status: "Open",
      department: "Release 1 test",
      basic_salary: 1000,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      days_to_pay: 22,
      overtime_amount: 0,
      bonuses: 0,
      arrears: 0,
      gross_pay: 1000,
      employee_ssnit: 55,
      employer_ssnit: 130,
      tier2: 25,
      paye_tax: 50,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      absence_deduction: 0,
      total_deductions: 105,
      net_pay: 895,
      tenant_id: CAANTA,
      net_only_adjustment: 0,
    });
    if (seedProcErr) {
      throw seedProcErr;
    }
  }

  const { data: registerRows } = await admin
    .from("salary_advance_register")
    .select("*")
    .eq("tenant_id", CAANTA)
    .eq("deduct_payroll_month", deductMonth)
    .eq("status", "outstanding");
  const advances = (registerRows ?? []) as SalaryAdvanceRegisterEntry[];

  const { data: procRows } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("payroll_month", deductMonth)
    .in("employee_id", employeeIds)
    .eq("status", "Open");

  const rowsForLock = applyRegisterSalaryAdvancesToLockRows(
    (procRows ?? []) as PayrollProcessingRow[],
    advances,
    deductMonth,
    bu.id,
  );
  for (const row of rowsForLock) {
    const expected = 100;
    if (Math.abs((Number(row.salary_advance) || 0) - expected) > 0.05) {
      throw new Error(
        `Register auto-fill: employee ${row.employee_id} salary_advance=${row.salary_advance}, expected ${expected}`,
      );
    }
  }
  console.log(
    "Lock rows use register-filled salary_advance (not manually seeded on payroll_processing).",
  );

  const cookie = await sessionCookie(userClient);
  const lockRes = await fetch(`${APP_URL}/api/hr-payroll/lock-period`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payrollMonth: deductMonth,
      periodYear: Number(deductMonth.slice(0, 4)),
      periodMonth: Number(deductMonth.slice(5, 7)),
      lockStatus: "Locked",
      rows: rowsForLock,
    }),
  });
  const lockPayload = (await lockRes.json()) as { error?: string };
  if (!lockRes.ok) {
    throw new Error(`Lock failed: ${lockPayload.error ?? lockRes.statusText}`);
  }

  const afterLock = await snapshot(admin, bu.id, monthIndex, "after payroll lock");
  logSnap(afterSave, afterLock);
  if (Math.abs(afterLock.receivable) > 0.05) {
    throw new Error(`After lock receivable should be 0; got ${afterLock.receivable}`);
  }
  console.log(
    `After lock: receivable cleared; BS diff=${afterLock.bsDiff} (payroll finance may shift cash while receivable clears)`,
  );

  const reopenRes = await fetch(`${APP_URL}/api/hr-payroll/release-period`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      payrollMonth: deductMonth,
      periodYear: Number(deductMonth.slice(0, 4)),
      periodMonth: Number(deductMonth.slice(5, 7)),
    }),
  });
  const reopenPayload = (await reopenRes.json()) as { error?: string };
  if (!reopenRes.ok) {
    throw new Error(`Release/reopen failed: ${reopenPayload.error ?? reopenRes.statusText}`);
  }

  const afterReopen = await snapshot(admin, bu.id, monthIndex, "after reopen");
  logSnap(afterSave, afterReopen);
  if (Math.abs(afterReopen.receivable - afterSave.receivable) > 0.05) {
    throw new Error("Receivable not restored after reopen");
  }
  assertStableBalance(afterReopen, baselineBsDiff);

  const [keepId, deleteId] = advanceIds;
  const { error: updErr } = await userClient.rpc("update_salary_advance", {
    p_payload: {
      tenant_id: CAANTA,
      advance_id: keepId,
      amount: 150,
    },
  });
  if (updErr) throw updErr;

  const afterEdit = await snapshot(admin, bu.id, monthIndex, "after edit one to 150");
  logSnap(afterReopen, afterEdit);
  assertStableBalance(afterEdit, baselineBsDiff);

  const { error: delErr } = await userClient.rpc("delete_salary_advance", {
    p_payload: { tenant_id: CAANTA, advance_id: deleteId },
  });
  if (delErr) throw delErr;

  const afterDelete = await snapshot(admin, bu.id, monthIndex, "after delete second");
  logSnap(afterEdit, afterDelete);
  assertStableBalance(afterDelete, baselineBsDiff);

  console.log("\nPASS: Caanta advance BS / cash-flow proof (authenticated saves + lock/reopen via session API).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
