/**
 * Recalculate June 2026 Davors payroll_history statutory columns
 * (employee_ssnit, employer_ssnit, tier2, paye_tax) with ERP proration, then
 * re-sync tax_ledger_entries. Does NOT touch basic/gross/net/allowances or
 * expense_register.
 *
 * Staging by default. Production requires:
 *   --env-file .env.local.backup --allow-production
 *
 * Usage:
 *   npx tsx scripts/recalc-june-2026-statutory-staging.ts --dry-run
 *   npx tsx scripts/recalc-june-2026-statutory-staging.ts
 *   npx tsx scripts/recalc-june-2026-statutory-staging.ts --env-file .env.local.backup --allow-production
 *
 * Optional:
 *   --tenant-id <uuid>   (default Davors)
 *   --payroll-month 2026-06-01
 *   --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  calculatePayrollRow,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  type PayrollEmployeeSource,
  type PayrollTaxConfigs,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  resolvePayrollLockFinancePeriod,
  buildPayrollExpenseReceiptNo,
  calculatePayrollLockFinanceTotals,
  PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  resolveSelectedPeriod,
  payrollMonthToPeriodKey,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import {
  PAYROLL_PERIOD_SOURCE_TYPE,
  syncPayrollPeriodTaxLedger,
} from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const DEFAULT_PAYROLL_MONTH = "2026-06-01";
const EXPECTED_WORKING_DAYS = 26;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HistoryRow = {
  id: string;
  employee_id: string;
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  overtime_amount: number | null;
  bonuses: number | null;
  arrears: number | null;
  gross_pay: number | null;
  net_pay: number | null;
  employee_ssnit: number | null;
  employer_ssnit: number | null;
  tier2: number | null;
  paye_tax: number | null;
};

type ProcessingDays = {
  employee_id: string;
  days_to_pay: number | null;
};

type StatutoryTotals = {
  employee_ssnit: number;
  employer_ssnit: number;
  tier2: number;
  paye_tax: number;
};

type RowDiff = {
  idPrefix: string;
  employment_type: string;
  days_to_pay: number;
  old: StatutoryTotals;
  neu: StatutoryTotals;
  gross_pay: number;
  basic_salary: number;
  calc_gross: number;
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: number | null | undefined): number {
  return Number(value) || 0;
}

function anonymizeId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function parseArgs(argv: string[]) {
  let tenantId = DAVORS_TENANT_ID;
  let payrollMonth = DEFAULT_PAYROLL_MONTH;
  let dryRun = false;
  let envFile = ".env.staging.local";
  let allowProduction = false;
  let ledgerOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--ledger-only") {
      ledgerOnly = true;
      continue;
    }
    if (arg === "--tenant-id") {
      tenantId = argv[++i] ?? tenantId;
      continue;
    }
    if (arg.startsWith("--tenant-id=")) {
      tenantId = arg.slice("--tenant-id=".length);
      continue;
    }
    if (arg === "--payroll-month") {
      payrollMonth = argv[++i] ?? payrollMonth;
      continue;
    }
    if (arg.startsWith("--payroll-month=")) {
      payrollMonth = arg.slice("--payroll-month=".length);
      continue;
    }
    if (arg === "--env-file") {
      envFile = argv[++i] ?? envFile;
      continue;
    }
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/recalc-june-2026-statutory-staging.ts [--dry-run] [--ledger-only] [--tenant-id <uuid>] [--payroll-month YYYY-MM-01] [--env-file <path> --allow-production]",
      );
      process.exit(0);
    }
  }

  return {
    tenantId,
    payrollMonth: payrollMonth.slice(0, 10),
    dryRun,
    envFile,
    allowProduction,
    ledgerOnly,
  };
}

function buildDatabaseUrlCandidates(projectRef: string): string[] {
  const candidates: string[] = [];
  const rebuildUrl = (rawUrl: string) => {
    const parsed = new URL(rawUrl);
    parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
    return parsed.toString();
  };

  const explicit =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;
  if (explicit) {
    candidates.push(explicit, rebuildUrl(explicit));
  }

  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password) {
    const encoded = encodeURIComponent(password);
    candidates.push(
      `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`,
    );
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function connectPostgres(projectRef: string): Promise<pg.Client> {
  const candidates = buildDatabaseUrlCandidates(projectRef);
  assert(
    candidates.length > 0,
    "Missing DATABASE_URL / SUPABASE_DB_PASSWORD for locked-row bypass",
  );

  let lastError: unknown = null;
  for (const connectionString of candidates) {
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore disconnect errors from failed auth attempts
      }
    }
  }

  throw new Error(
    `Unable to connect to Postgres for locked-row bypass (${
      lastError instanceof Error ? lastError.message : String(lastError)
    })`,
  );
}

function sumStatutory(rows: Array<{ old: StatutoryTotals; neu: StatutoryTotals }>): {
  old: StatutoryTotals;
  neu: StatutoryTotals;
} {
  const empty = (): StatutoryTotals => ({
    employee_ssnit: 0,
    employer_ssnit: 0,
    tier2: 0,
    paye_tax: 0,
  });
  const old = empty();
  const neu = empty();
  for (const row of rows) {
    old.employee_ssnit = round2(old.employee_ssnit + row.old.employee_ssnit);
    old.employer_ssnit = round2(old.employer_ssnit + row.old.employer_ssnit);
    old.tier2 = round2(old.tier2 + row.old.tier2);
    old.paye_tax = round2(old.paye_tax + row.old.paye_tax);
    neu.employee_ssnit = round2(neu.employee_ssnit + row.neu.employee_ssnit);
    neu.employer_ssnit = round2(neu.employer_ssnit + row.neu.employer_ssnit);
    neu.tier2 = round2(neu.tier2 + row.neu.tier2);
    neu.paye_tax = round2(neu.paye_tax + row.neu.paye_tax);
  }
  return { old, neu };
}

function formatTotals(label: string, t: StatutoryTotals) {
  console.log(
    `  ${label}: emp_ssnit=${t.employee_ssnit.toFixed(2)}  er_ssnit=${t.employer_ssnit.toFixed(2)}  tier2=${t.tier2.toFixed(2)}  paye=${t.paye_tax.toFixed(2)}  (er+tier2=${(t.employer_ssnit + t.tier2).toFixed(2)})`,
  );
}

async function loadTaxConfigs(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PayrollTaxConfigs> {
  const [ssnitRes, casualRes, payeRes] = await Promise.all([
    admin
      .from("ssnit_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("casual_tax_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  if (ssnitRes.error) throw new Error(`ssnit_rate_config: ${ssnitRes.error.message}`);
  if (casualRes.error) {
    throw new Error(`casual_tax_rate_config: ${casualRes.error.message}`);
  }
  if (payeRes.error) throw new Error(`paye_tax_bands: ${payeRes.error.message}`);

  return {
    ssnitRows: mapSsnitConfigRows(
      (ssnitRes.data as Record<string, unknown>[] | null) ?? [],
    ),
    casualRows: mapCasualTaxConfigRows(
      (casualRes.data as Record<string, unknown>[] | null) ?? [],
    ),
    payeBands: mapPayrollPayeBandRows(
      (payeRes.data as Record<string, unknown>[] | null) ?? [],
    ),
  };
}

async function main() {
  const { tenantId, payrollMonth, dryRun, envFile, allowProduction, ledgerOnly } =
    parseArgs(process.argv.slice(2));

  assert(UUID_RE.test(tenantId), `Invalid --tenant-id: ${tenantId}`);
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(payrollMonth),
    `Invalid --payroll-month: ${payrollMonth}`,
  );

  const envPath = resolve(process.cwd(), envFile);
  loadEnvForce(envPath);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const projectRef = new URL(url).hostname.split(".")[0];
  const isStaging = projectRef === STAGING_PROJECT_REF;
  const isProduction = projectRef === PRODUCTION_PROJECT_REF;
  if (isProduction) {
    assert(
      allowProduction,
      `Refusing production project ref "${projectRef}" without --allow-production.`,
    );
  } else if (!isStaging) {
    throw new Error(
      `Refusing unknown project ref "${projectRef}" (expected staging ${STAGING_PROJECT_REF} or production ${PRODUCTION_PROJECT_REF}).`,
    );
  } else if (allowProduction) {
    throw new Error(
      `Refusing --allow-production against staging project ref "${projectRef}".`,
    );
  }

  const year = Number.parseInt(payrollMonth.slice(0, 4), 10);
  const month = Number.parseInt(payrollMonth.slice(5, 7), 10);
  const period = resolveSelectedPeriod(year, month);
  assert(
    period.totalWorkingDays === EXPECTED_WORKING_DAYS,
    `Expected June totalWorkingDays=${EXPECTED_WORKING_DAYS}, got ${period.totalWorkingDays}`,
  );

  const financePeriod = resolvePayrollLockFinancePeriod(payrollMonth);
  assert(financePeriod, `Unable to resolve finance period for ${payrollMonth}`);

  console.log(
    `=== Recalc June 2026 statutory (${isProduction ? "PRODUCTION" : "staging"}) ===`,
  );
  console.log(`Env file: ${envFile}`);
  console.log(
    `Project ref: ${projectRef} (${isProduction ? "PRODUCTION" : "staging"} OK)`,
  );
  console.log(`Tenant: ${tenantId}`);
  console.log(`Payroll month: ${payrollMonth}`);
  console.log(`Period end: ${financePeriod.periodEndDate}`);
  console.log(`totalWorkingDays: ${period.totalWorkingDays}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : ledgerOnly ? "LEDGER-ONLY" : "WRITE"}`);
  console.log(
    "Scope: payroll_history statutory cols + tax_ledger sync only; expense_register READ-ONLY",
  );

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const taxConfigs = await loadTaxConfigs(admin, tenantId);
  assert(taxConfigs.ssnitRows.length > 0, "No ssnit_rate_config rows for tenant");
  assert(taxConfigs.payeBands.length > 0, "No paye_tax_bands rows for tenant");

  const { data: historyData, error: historyError } = await admin
    .from("payroll_history")
    .select(
      "id, employee_id, basic_salary, housing_allowance, transport_allowance, other_allowances, overtime_amount, bonuses, arrears, gross_pay, net_pay, employee_ssnit, employer_ssnit, tier2, paye_tax",
    )
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth)
    .order("employee_id", { ascending: true });

  if (historyError) {
    throw new Error(`payroll_history load failed: ${historyError.message}`);
  }

  const historyRows = (historyData as HistoryRow[] | null) ?? [];
  assert(
    historyRows.length === 20,
    `Expected 20 June history rows, found ${historyRows.length}`,
  );

  const employeeIds = [...new Set(historyRows.map((r) => r.employee_id))];

  const [{ data: employeesData, error: empError }, { data: processingData, error: procError }] =
    await Promise.all([
      admin
        .from("employees")
        .select(
          "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
        )
        .eq("tenant_id", tenantId)
        .in("employee_id", employeeIds),
      admin
        .from("payroll_processing")
        .select("employee_id, days_to_pay")
        .eq("tenant_id", tenantId)
        .eq("payroll_month", payrollMonth)
        .in("employee_id", employeeIds),
    ]);

  if (empError) throw new Error(`employees load failed: ${empError.message}`);
  if (procError) {
    throw new Error(`payroll_processing load failed: ${procError.message}`);
  }

  const employeesById = new Map(
    ((employeesData as PayrollEmployeeSource[] | null) ?? []).map((e) => [
      e.employee_id,
      e,
    ]),
  );
  const daysByEmployee = new Map(
    ((processingData as ProcessingDays[] | null) ?? []).map((p) => [
      p.employee_id,
      p.days_to_pay,
    ]),
  );

  const diffs: RowDiff[] = [];
  const employmentTypeCounts = new Map<string, number>();

  for (const row of historyRows) {
    const emp = employeesById.get(row.employee_id);
    assert(emp, `Missing employee for history id ${anonymizeId(row.id)}`);

    const employmentType = (emp.employment_type ?? "").trim() || "(blank)";
    employmentTypeCounts.set(
      employmentType,
      (employmentTypeCounts.get(employmentType) ?? 0) + 1,
    );

    const daysFromProcessing = daysByEmployee.get(row.employee_id);
    assert(
      daysFromProcessing !== undefined && daysFromProcessing !== null,
      `Missing payroll_processing.days_to_pay for history ${anonymizeId(row.id)}`,
    );
    const daysToPay = Number(daysFromProcessing);

    // Use history contract/pay components so paid gross stays the source of truth
    // for PAYE base; employment_type comes from employees for Casual branch.
    const employeeSource: PayrollEmployeeSource = {
      ...emp,
      basic_salary: row.basic_salary,
      housing_allowance: row.housing_allowance,
      transport_allowance: row.transport_allowance,
      other_allowances: row.other_allowances,
    };

    const calculated = calculatePayrollRow(
      employeeSource,
      period,
      taxConfigs,
      {
        absenceCount: 0,
        overtimeAmount: num(row.overtime_amount),
        loanRepayment: 0,
      },
      {
        days_to_pay: daysToPay,
        bonuses: num(row.bonuses),
        arrears: num(row.arrears),
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
      },
    );

    diffs.push({
      idPrefix: anonymizeId(row.id),
      employment_type: employmentType,
      days_to_pay: daysToPay,
      old: {
        employee_ssnit: num(row.employee_ssnit),
        employer_ssnit: num(row.employer_ssnit),
        tier2: num(row.tier2),
        paye_tax: num(row.paye_tax),
      },
      neu: {
        employee_ssnit: calculated.employee_ssnit,
        employer_ssnit: calculated.employer_ssnit,
        tier2: calculated.tier2,
        paye_tax: calculated.paye_tax,
      },
      gross_pay: num(row.gross_pay),
      basic_salary: num(row.basic_salary),
      calc_gross: calculated.gross_pay,
    });
  }

  console.log("\nEmployment types in period:");
  for (const [type, count] of [...employmentTypeCounts.entries()].sort()) {
    console.log(`  ${type}: ${count}`);
  }

  const daysSet = new Set(diffs.map((d) => d.days_to_pay));
  console.log(`days_to_pay values: ${[...daysSet].join(", ")}`);

  const grossMismatches = diffs.filter(
    (d) => Math.abs(d.gross_pay - d.calc_gross) >= 0.01,
  );
  if (grossMismatches.length > 0) {
    console.log(
      `\nNote: ${grossMismatches.length} row(s) have stored gross ≠ formula gross (statutory still applied; paid fields unchanged):`,
    );
    for (const d of grossMismatches) {
      console.log(
        `  ${d.idPrefix} stored=${d.gross_pay.toFixed(2)} calc=${d.calc_gross.toFixed(2)} type=${d.employment_type}`,
      );
    }
  }

  console.log("\nPer-row OLD → NEW (anonymized id prefix):");
  for (const d of diffs) {
    console.log(
      `  ${d.idPrefix} [${d.employment_type}] days=${d.days_to_pay} | emp ${d.old.employee_ssnit.toFixed(2)}→${d.neu.employee_ssnit.toFixed(2)} | er ${d.old.employer_ssnit.toFixed(2)}→${d.neu.employer_ssnit.toFixed(2)} | t2 ${d.old.tier2.toFixed(2)}→${d.neu.tier2.toFixed(2)} | paye ${d.old.paye_tax.toFixed(2)}→${d.neu.paye_tax.toFixed(2)}`,
    );
  }

  const totals = sumStatutory(diffs);
  console.log("\nPeriod totals OLD vs NEW:");
  formatTotals("OLD", totals.old);
  formatTotals("NEW", totals.neu);
  formatTotals("DELTA (NEW-OLD)", {
    employee_ssnit: round2(totals.neu.employee_ssnit - totals.old.employee_ssnit),
    employer_ssnit: round2(totals.neu.employer_ssnit - totals.old.employer_ssnit),
    tier2: round2(totals.neu.tier2 - totals.old.tier2),
    paye_tax: round2(totals.neu.paye_tax - totals.old.paye_tax),
  });

  // --- Expense Register READ-ONLY check ---
  const periodKey =
    payrollMonthToPeriodKey(payrollMonth) ?? payrollMonth.slice(0, 7);
  const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", periodKey);

  const { data: expenseByReceipt, error: expenseReceiptError } = await admin
    .from("expense_register")
    .select(
      "id, receipt_no, amount, expense_category, payment_status, date, description",
    )
    .eq("tenant_id", tenantId)
    .eq("receipt_no", essnitReceipt)
    .maybeSingle();

  if (expenseReceiptError) {
    throw new Error(
      `expense_register receipt lookup failed: ${expenseReceiptError.message}`,
    );
  }

  let expenseRow = expenseByReceipt;
  let expenseMatchMode = expenseRow ? "receipt_no" : null;

  if (!expenseRow) {
    // Staging may have manually posted ESSNIT without PAYROLL-ESSNIT-YYYY-MM.
    const { data: juneExpenses, error: juneExpenseError } = await admin
      .from("expense_register")
      .select(
        "id, receipt_no, amount, expense_category, payment_status, date, description",
      )
      .eq("tenant_id", tenantId)
      .gte("date", `${payrollMonth.slice(0, 7)}-01`)
      .lte("date", financePeriod.periodEndDate);

    if (juneExpenseError) {
      throw new Error(
        `expense_register June scan failed: ${juneExpenseError.message}`,
      );
    }

    const candidates = (juneExpenses ?? []).filter((row) => {
      const cat = String(row.expense_category ?? "");
      const desc = String(row.description ?? "");
      return (
        cat === PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT ||
        /employer\s*ssnit/i.test(cat) ||
        /employer\s*ssnit/i.test(desc)
      );
    });

    if (candidates.length === 1) {
      expenseRow = candidates[0];
      expenseMatchMode = "description/category fallback";
    } else if (candidates.length > 1) {
      console.log(
        `\nWARN: ${candidates.length} Employer SSNIT expense candidates in June — listing amounts only:`,
      );
      for (const c of candidates) {
        console.log(
          `  amount=${num(c.amount as number).toFixed(2)} date=${c.date} receipt=${c.receipt_no || "(blank)"}`,
        );
      }
      // Prefer amount matching OLD employer_ssnit (common manual post without tier2).
      const matchOldEr = candidates.find(
        (c) => Math.abs(num(c.amount as number) - totals.old.employer_ssnit) < 0.02,
      );
      const matchOldErTier2 = candidates.find(
        (c) =>
          Math.abs(
            num(c.amount as number) -
              (totals.old.employer_ssnit + totals.old.tier2),
          ) < 0.02,
      );
      expenseRow = matchOldErTier2 ?? matchOldEr ?? candidates[0];
      expenseMatchMode = "multi-candidate heuristic";
    }
  }

  const newEmployerContribution = round2(
    totals.neu.employer_ssnit + totals.neu.tier2,
  );
  const oldEmployerContribution = round2(
    totals.old.employer_ssnit + totals.old.tier2,
  );

  console.log("\n=== Expense Register (READ ONLY — not modified) ===");
  console.log(`Expected auto receipt_no: ${essnitReceipt}`);
  if (!expenseRow) {
    console.log("No matching Employer SSNIT expense row found.");
  } else {
    const expenseAmount = num(expenseRow.amount as number);
    const vsNewErTier2 = round2(expenseAmount - newEmployerContribution);
    const vsNewErOnly = round2(expenseAmount - totals.neu.employer_ssnit);
    console.log(`Match mode: ${expenseMatchMode}`);
    console.log(
      `Found: category=${expenseRow.expense_category} status=${expenseRow.payment_status} date=${expenseRow.date} receipt=${expenseRow.receipt_no || "(blank)"}`,
    );
    console.log(`Expense amount (posted): ${expenseAmount.toFixed(2)}`);
    console.log(
      `Corrected employer_ssnit+tier2 (NEW lock formula): ${newEmployerContribution.toFixed(2)}`,
    );
    console.log(
      `Corrected employer_ssnit only (NEW): ${totals.neu.employer_ssnit.toFixed(2)}`,
    );
    console.log(
      `Prior history employer_ssnit / +tier2: ${totals.old.employer_ssnit.toFixed(2)} / ${oldEmployerContribution.toFixed(2)}`,
    );
    // Compare to lock formula (employer + tier2) — canonical P&L target.
    if (Math.abs(vsNewErTier2) < 0.01) {
      console.log(
        "Expense matches corrected employer_ssnit+tier2 — no correction needed.",
      );
    } else if (vsNewErTier2 > 0) {
      console.log(
        `Expense is OVERSTATED vs corrected employer_ssnit+tier2 by ${vsNewErTier2.toFixed(2)} — needs correcting (manual; not applied here).`,
      );
    } else {
      console.log(
        `Expense is UNDERSTATED vs corrected employer_ssnit+tier2 by ${Math.abs(vsNewErTier2).toFixed(2)} — needs correcting (manual; not applied here).`,
      );
    }
    if (Math.abs(expenseAmount - totals.old.employer_ssnit) < 0.02) {
      console.log(
        `Note: posted amount equals OLD employer_ssnit only (excludes tier2). vs NEW employer_ssnit-only delta=${vsNewErOnly.toFixed(2)}.`,
      );
    }
  }

  if (dryRun) {
    console.log(
      "\nDRY-RUN complete — no payroll_history or tax_ledger writes. Re-run without --dry-run to apply.",
    );
    console.log(
      `Explicit: ${isProduction ? "production" : "staging"} dry-run; expense_register not modified.`,
    );
    return;
  }

  if (!ledgerOnly) {
    // --- Apply statutory UPDATEs (bypass locked-row trigger via pg, same pattern
    // as admin_delete_payroll_history_for_month / release-locked-payroll-period.sql) ---
    console.log("\nApplying payroll_history statutory UPDATEs…");

    const rpcPayload = historyRows.map((row, index) => ({
      id: row.id,
      employee_ssnit: diffs[index].neu.employee_ssnit,
      employer_ssnit: diffs[index].neu.employer_ssnit,
      tier2: diffs[index].neu.tier2,
      paye_tax: diffs[index].neu.paye_tax,
    }));

    let updated = 0;
    let appliedVia: "postgres" | "rpc" | null = null;

    try {
      const pgClient = await connectPostgres(projectRef);
      try {
        await pgClient.query("BEGIN");
        await pgClient.query(
          "ALTER TABLE payroll_history DISABLE TRIGGER trg_protect_locked_payroll",
        );

        for (let i = 0; i < historyRows.length; i += 1) {
          const row = historyRows[i];
          const neu = diffs[i].neu;
          const result = await pgClient.query(
            `UPDATE payroll_history
             SET employee_ssnit = $1,
                 employer_ssnit = $2,
                 tier2 = $3,
                 paye_tax = $4
             WHERE tenant_id = $5::uuid
               AND id = $6::uuid
               AND payroll_month = $7::date`,
            [
              neu.employee_ssnit,
              neu.employer_ssnit,
              neu.tier2,
              neu.paye_tax,
              tenantId,
              row.id,
              payrollMonth,
            ],
          );
          if (result.rowCount !== 1) {
            throw new Error(
              `UPDATE matched ${result.rowCount} rows for ${anonymizeId(row.id)}`,
            );
          }
          updated += 1;
        }

        await pgClient.query(
          "ALTER TABLE payroll_history ENABLE TRIGGER trg_protect_locked_payroll",
        );
        await pgClient.query("COMMIT");
        appliedVia = "postgres";
      } catch (err) {
        try {
          await pgClient.query(
            "ALTER TABLE payroll_history ENABLE TRIGGER trg_protect_locked_payroll",
          );
        } catch {
          // best-effort re-enable before rollback
        }
        await pgClient.query("ROLLBACK");
        throw err;
      } finally {
        await pgClient.end();
      }
    } catch (pgError) {
      console.warn(
        `Postgres locked-row bypass unavailable (${
          pgError instanceof Error ? pgError.message : String(pgError)
        }); trying admin_update_payroll_history_statutory RPC…`,
      );

      const { data: rpcUpdated, error: rpcError } = await admin.rpc(
        "admin_update_payroll_history_statutory",
        {
          p_tenant_id: tenantId,
          p_payroll_month: payrollMonth,
          p_rows: rpcPayload,
        },
      );

      if (rpcError) {
        throw new Error(
          `Unable to update locked payroll_history via Postgres or RPC (${rpcError.message}). ` +
            `Apply scripts/fix-june-2026-statutory-production.sql in the production SQL Editor, ` +
            `or first apply scripts/115_admin_update_payroll_history_statutory.sql then re-run this script.`,
        );
      }

      updated = Number(rpcUpdated) || 0;
      appliedVia = "rpc";
    }

    console.log(
      `Updated ${updated} / ${historyRows.length} payroll_history rows via ${appliedVia}.`,
    );
    assert(
      updated === historyRows.length,
      `Expected ${historyRows.length} updates, got ${updated}`,
    );
  } else {
    console.log(
      "\nLEDGER-ONLY mode: skipping payroll_history UPDATEs; syncing tax ledger from current history.",
    );
  }

  // Reload history for ledger sync
  const { data: refreshed, error: refreshError } = await admin
    .from("payroll_history")
    .select(
      "gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax",
    )
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (refreshError) {
    throw new Error(`reload history failed: ${refreshError.message}`);
  }

  const refreshedRows = refreshed ?? [];
  const ledgerResult = await syncPayrollPeriodTaxLedger(
    admin,
    {
      payrollMonth: financePeriod.payrollMonth,
      monthLabel: financePeriod.monthLabel,
      periodEndDate: financePeriod.periodEndDate,
    },
    refreshedRows,
    tenantId,
    { dryRun: false },
  );

  console.log("\n=== Statutory Ledger sync ===");
  console.log(
    `source_id=${ledgerResult.sourceId} insert=${ledgerResult.inserted} update=${ledgerResult.updated} unchanged=${ledgerResult.unchanged} delete=${ledgerResult.deleted} skipped_paid=${ledgerResult.skippedPaid}`,
  );
  for (const leg of ledgerResult.legs) {
    console.log(
      `  leg: ${leg.tax_component}=${leg.tax_amount.toFixed(2)} action=${leg.action}`,
    );
  }

  // Verify open June ledger amounts match NEW history sums
  const sourceId = ledgerResult.sourceId;
  const { data: ledgerRows, error: ledgerError } = await admin
    .from("tax_ledger_entries")
    .select("tax_component, status, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("status", "open");

  if (ledgerError) {
    throw new Error(`ledger verify failed: ${ledgerError.message}`);
  }

  const historyTotals = calculatePayrollLockFinanceTotals(
    refreshedRows.map((r) => ({
      gross_pay: num(r.gross_pay as number | null),
      employee_ssnit: num(r.employee_ssnit as number | null),
      employer_ssnit: num(r.employer_ssnit as number | null),
      tier2: num(r.tier2 as number | null),
      paye_tax: num(r.paye_tax as number | null),
    })),
  );

  const expectedByComponent: Record<string, number> = {
    paye: historyTotals.totalPayeTax,
    ssnit_employee: round2(
      refreshedRows.reduce(
        (s, r) => s + num(r.employee_ssnit as number | null),
        0,
      ),
    ),
    ssnit_employer_tier1: round2(
      refreshedRows.reduce(
        (s, r) => s + num(r.employer_ssnit as number | null),
        0,
      ),
    ),
    ssnit_tier2: round2(
      refreshedRows.reduce((s, r) => s + num(r.tier2 as number | null), 0),
    ),
  };

  console.log("\n=== Ledger vs NEW history verification ===");
  const openByComponent = new Map<string, number>();
  for (const leg of ledgerRows ?? []) {
    openByComponent.set(
      String(leg.tax_component),
      num(leg.tax_amount as number),
    );
  }

  let ledgerOk = true;
  for (const [component, expected] of Object.entries(expectedByComponent)) {
    if (expected <= 0) {
      const present = openByComponent.get(component);
      if (present !== undefined) {
        console.log(
          `  FAIL ${component}: expected absent (0) but open amount=${present.toFixed(2)}`,
        );
        ledgerOk = false;
      } else {
        console.log(`  OK   ${component}: absent (zero)`);
      }
      continue;
    }
    const actual = openByComponent.get(component);
    if (actual === undefined) {
      console.log(
        `  FAIL ${component}: expected ${expected.toFixed(2)} but no open row`,
      );
      ledgerOk = false;
    } else if (Math.abs(actual - expected) >= 0.01) {
      console.log(
        `  FAIL ${component}: ledger=${actual.toFixed(2)} history=${expected.toFixed(2)}`,
      );
      ledgerOk = false;
    } else {
      console.log(
        `  OK   ${component}: ${actual.toFixed(2)} matches history`,
      );
    }
  }
  assert(ledgerOk, "Ledger open amounts do not match corrected history");

  // Confirm paid fields unchanged sample
  const { data: verifyPaid, error: verifyPaidError } = await admin
    .from("payroll_history")
    .select("id, basic_salary, gross_pay, net_pay")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (verifyPaidError) {
    throw new Error(`paid-field verify failed: ${verifyPaidError.message}`);
  }

  const paidById = new Map(
    historyRows.map((r) => [
      r.id,
      {
        basic_salary: num(r.basic_salary),
        gross_pay: num(r.gross_pay),
        net_pay: num(r.net_pay),
      },
    ]),
  );
  for (const v of verifyPaid ?? []) {
    const before = paidById.get(String(v.id));
    assert(before, `Unexpected history id after update`);
    assert(
      Math.abs(num(v.basic_salary as number) - before.basic_salary) < 0.001 &&
        Math.abs(num(v.gross_pay as number) - before.gross_pay) < 0.001 &&
        Math.abs(num(v.net_pay as number) - before.net_pay) < 0.001,
      `Paid fields changed for ${anonymizeId(String(v.id))} — abort condition`,
    );
  }
  console.log("Paid fields (basic/gross/net) unchanged: confirmed.");

  console.log("\nDone.");
  console.log(
    `Explicit: ${isProduction ? "production" : "staging"} write applied; expense_register not modified by this script.`,
  );
}

main().catch((err) => {
  console.error("\nAborted:", err instanceof Error ? err.message : err);
  process.exit(1);
});
