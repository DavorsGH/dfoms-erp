/**
 * PRODUCTION: June cash_paid + July net_only_adjustment + forfeited income.
 *
 * Usage:
 *   npx tsx scripts/apply-june-july-payroll-corrections-production.ts --dry-run
 *   npx tsx scripts/apply-june-july-payroll-corrections-production.ts --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const BANK_PAID = 7025.57;
const AUTO_RECEIPT = "PAYROLL-SAL-2026-06";
const CASH_PAID_NOTES = `cash_paid=${BANK_PAID}`;
const JULY_MONTH = "2026-07-01";
const JUNE_MONTH = "2026-06-01";

/** Unused — shortfalls recomputed live from June nets. Kept as documentation. */
const EXPECTED_ACTIVE_TOTAL = 543.03;
const EXPECTED_INACTIVE_TOTAL = 88.09;

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-production") allowProduction = true;
    else if (arg === "--env-file") envFile = argv[++i] ?? envFile;
  }
  return { envFile, allowProduction, dryRun };
}

function buildDatabaseUrlCandidates(projectRef: string): string[] {
  const candidates: string[] = [];
  const explicit =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;
  if (explicit) candidates.push(explicit);

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
  if (!candidates.length) {
    throw new Error("Missing DATABASE_URL / SUPABASE_DB_PASSWORD");
  }
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
        /* ignore */
      }
    }
  }
  throw lastError ?? new Error("Could not connect to Postgres");
}

async function computeBs(admin, label: string) {
  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select(
        "entry_date, period_month, direction, tax_component, tax_amount, status",
      )
      .eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  const cashFlow = (expenseEntries ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  const july = getBalanceCheckForPeriod(report, 6);
  const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const cash = report.rows.find((r) => r.label.includes("Cash"));
  const aw = report.rows.find((r) => r.label.includes("Accrued Wages"));
  console.log(`\n=== BS ${label} ===`);
  console.log(
    `July: assets=${july.totalAssets} L+E=${july.totalLiabilitiesAndEquity} gap=${july.difference}`,
  );
  console.log(
    `FY:   assets=${fy.totalAssets} L+E=${fy.totalLiabilitiesAndEquity} gap=${fy.difference}`,
  );
  console.log(`Cash June/July: ${cash?.amounts[5]} / ${cash?.amounts[6]}`);
  console.log(`Accrued Wages June/July: ${aw?.amounts[5]} / ${aw?.amounts[6]}`);
  return { july, fy, cash };
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const projectRef = new URL(url).hostname.split(".")[0];
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing non-production ref ${projectRef}`);
  }
  if (!allowProduction && !dryRun) {
    throw new Error("Require --allow-production for writes (or --dry-run)");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve live proportional shortfalls from June nets
  const { data: juneHist } = await admin
    .from("payroll_history")
    .select("employee_id, net_pay")
    .eq("tenant_id", TENANT)
    .eq("payroll_month", JUNE_MONTH);
  const { data: employees } = await admin
    .from("employees")
    .select("employee_id, staff_id, full_name, employment_status")
    .eq("tenant_id", TENANT);
  const empById = new Map(
    (employees ?? []).map((e) => [String(e.employee_id), e]),
  );

  const totNet = r2(
    (juneHist ?? []).reduce((s, r) => s + (Number(r.net_pay) || 0), 0),
  );
  type ShortRow = {
    employeeId: string;
    staffId: string;
    name: string;
    short: number;
    status: string;
    alloc: number;
    net: number;
  };
  const shortfalls: ShortRow[] = [];
  for (const r of juneHist ?? []) {
    const emp = empById.get(String(r.employee_id));
    const net = Number(r.net_pay) || 0;
    const alloc = r2(BANK_PAID * (totNet > 0 ? net / totNet : 0));
    shortfalls.push({
      employeeId: String(r.employee_id),
      staffId: String(emp?.staff_id ?? "?"),
      name: String(emp?.full_name ?? r.employee_id),
      net,
      alloc,
      short: r2(net - alloc),
      status: String(emp?.employment_status ?? "?"),
    });
  }
  const allocSum = r2(shortfalls.reduce((s, r) => s + r.alloc, 0));
  const drift = r2(BANK_PAID - allocSum);
  if (Math.abs(drift) >= 0.01 && shortfalls.length) {
    shortfalls.sort((a, b) => b.net - a.net);
    shortfalls[0].alloc = r2(shortfalls[0].alloc + drift);
    shortfalls[0].short = r2(shortfalls[0].net - shortfalls[0].alloc);
  }

  const activeRows = shortfalls.filter(
    (s) => s.status.trim().toLowerCase() === "active",
  );
  const inactiveRows = shortfalls.filter(
    (s) => s.status.trim().toLowerCase() !== "active",
  );
  const activeSum = r2(activeRows.reduce((s, r) => s + r.short, 0));
  const inactiveSum = r2(inactiveRows.reduce((s, r) => s + r.short, 0));

  console.log(
    "Active shortfalls:",
    activeRows.map((r) => `${r.staffId}=${r.short}`).join(", "),
  );
  console.log("Active total", activeSum, "expected", EXPECTED_ACTIVE_TOTAL);
  console.log("Inactive total", inactiveSum, "expected", EXPECTED_INACTIVE_TOTAL);
  if (Math.abs(activeSum - EXPECTED_ACTIVE_TOTAL) > 0.05) {
    throw new Error(
      `Active shortfall mismatch ${activeSum} vs ${EXPECTED_ACTIVE_TOTAL}`,
    );
  }
  if (Math.abs(inactiveSum - EXPECTED_INACTIVE_TOTAL) > 0.05) {
    throw new Error(
      `Inactive shortfall mismatch ${inactiveSum} vs ${EXPECTED_INACTIVE_TOTAL}`,
    );
  }

  const { data: autoRow } = await admin
    .from("expense_register")
    .select("id, amount, payment_status, notes, receipt_no")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", AUTO_RECEIPT)
    .maybeSingle();
  if (!autoRow) throw new Error("PAYROLL-SAL-2026-06 missing");
  if (Number(autoRow.amount) !== 8124.83) {
    throw new Error(`Unexpected PAYROLL-SAL amount ${autoRow.amount}`);
  }
  if (autoRow.payment_status !== "Paid") {
    throw new Error(`Unexpected PAYROLL-SAL status ${autoRow.payment_status}`);
  }
  console.log("PAYROLL-SAL before notes:", autoRow.notes);

  await computeBs(admin, "BEFORE");

  if (dryRun) {
    console.log("\nDRY-RUN — would:");
    console.log("  1. Apply 116_payroll_net_only_adjustment.sql");
    console.log(`  2. Set notes=${CASH_PAID_NOTES} on ${AUTO_RECEIPT}`);
    console.log(`  3. Set net_only_adjustment on ${activeRows.length} July rows`);
    console.log(`  4. Insert Income Register Other Income ${EXPECTED_INACTIVE_TOTAL}`);
    console.log("  5. Annotate July month_end_close notes with June correction");
    return;
  }

  if (!allowProduction) throw new Error("Refusing writes without --allow-production");

  // 1. Cash paid notes on PAYROLL-SAL (service role — no DDL)
  const { error: notesErr } = await admin
    .from("expense_register")
    .update({ notes: CASH_PAID_NOTES })
    .eq("tenant_id", TENANT)
    .eq("id", autoRow.id)
    .eq("receipt_no", AUTO_RECEIPT);
  if (notesErr) throw notesErr;
  console.log("Set cash_paid notes on PAYROLL-SAL");

  // 2. Income Register forfeited amount (service role — no DDL)
  const FORFEIT_DESC =
    "June correction forfeited (DF0007, DF0015, DF0018, DF0019)";
  const { data: existingIncome } = await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("description", FORFEIT_DESC)
    .maybeSingle();
  if (existingIncome) {
    console.log("Income entry already exists:", existingIncome.id);
  } else {
    const { data: inserted, error: incErr } = await admin
      .from("income_register")
      .insert({
        tenant_id: TENANT,
        date: "2026-06-30",
        invoice_no: "ADJ-JUNE-FORFEIT-2026",
        client_id: null,
        customer_name: null,
        entry_type: "service",
        service_category: "Other Income",
        description: FORFEIT_DESC,
        amount: EXPECTED_INACTIVE_TOTAL,
        amount_received: 0,
        outstanding_balance: EXPECTED_INACTIVE_TOTAL,
        payment_status: "Unpaid",
        due_date: "2026-06-30",
        notes:
          "Forfeited June wage shortfall for terminated/inactive staff; non-cash P&L income.",
        tax_inclusive: true,
      })
      .select("id, amount, amount_received, service_category, description")
      .maybeSingle();
    if (incErr) throw incErr;
    console.log("Inserted income:", inserted);
  }

  // 3. Schema migration (requires DATABASE_URL / DB password)
  const columnProbe = await admin
    .from("payroll_processing")
    .select("id, net_only_adjustment")
    .limit(1);
  const columnExists = !columnProbe.error;
  if (columnExists) {
    console.log("net_only_adjustment already present — skip migration");
  } else {
    const sqlText = readFileSync(
      resolve(process.cwd(), "scripts/116_payroll_net_only_adjustment.sql"),
      "utf8",
    );
    let pgClient: pg.Client;
    try {
      pgClient = await connectPostgres(projectRef);
    } catch (pgErr) {
      console.error(
        "\nBLOCKED: cannot apply DDL — production DATABASE_URL password auth failed.",
      );
      console.error(
        "Cash notes + Income Register were applied. Run scripts/116_payroll_net_only_adjustment.sql in Supabase SQL Editor, then re-run this script.",
      );
      throw pgErr;
    }
    try {
      await pgClient.query(sqlText);
      const check = await pgClient.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'net_only_adjustment'
        AND table_name IN ('payroll_processing', 'payroll_history')
      ORDER BY table_name
    `);
      console.log("Migration columns:", check.rows);
      if (check.rows.length < 2) {
        throw new Error("net_only_adjustment missing after migration");
      }
    } finally {
      await pgClient.end();
    }
  }

  // 4. July net_only_adjustment + recalculate net_pay
  const { data: julyRows, error: julyErr } = await admin
    .from("payroll_processing")
    .select(
      "id, employee_id, gross_pay, total_deductions, net_pay, paye_tax, employee_ssnit, net_only_adjustment",
    )
    .eq("tenant_id", TENANT)
    .eq("payroll_month", JULY_MONTH);
  if (julyErr) throw julyErr;

  for (const target of activeRows) {
    const row = (julyRows ?? []).find(
      (r) => String(r.employee_id) === target.employeeId,
    );
    if (!row) {
      throw new Error(
        `July processing missing for ${target.staffId} ${target.employeeId}`,
      );
    }
    const baseNet = r2(
      Math.max(
        (Number(row.gross_pay) || 0) - (Number(row.total_deductions) || 0),
        0,
      ),
    );
    const newNet = r2(baseNet + target.short);
    // Guard: PAYE/SSNIT unchanged
    const { data: updated, error: updErr } = await admin
      .from("payroll_processing")
      .update({
        net_only_adjustment: target.short,
        net_pay: newNet,
      })
      .eq("tenant_id", TENANT)
      .eq("id", row.id)
      .eq("employee_id", target.employeeId)
      .select("id, employee_id, net_only_adjustment, net_pay, paye_tax, employee_ssnit")
      .maybeSingle();
    if (updErr) throw updErr;
    if (!updated) throw new Error(`Update failed for ${target.staffId}`);
    if (Number(updated.paye_tax) !== Number(row.paye_tax)) {
      throw new Error(`PAYE changed for ${target.staffId}`);
    }
    if (Number(updated.employee_ssnit) !== Number(row.employee_ssnit)) {
      throw new Error(`SSNIT changed for ${target.staffId}`);
    }
    console.log(
      `July ${target.staffId}: net_only_adjustment=${updated.net_only_adjustment} net ${row.net_pay}→${updated.net_pay}`,
    );
  }

  // Verify inactive not touched
  for (const inactive of inactiveRows) {
    const row = (julyRows ?? []).find(
      (r) => String(r.employee_id) === inactive.employeeId,
    );
    if (row) {
      throw new Error(
        `Inactive ${inactive.staffId} unexpectedly still in July processing`,
      );
    }
  }

  // 5. month_end_close note
  const { data: mec } = await admin
    .from("month_end_close")
    .select("month, notes, total_net_pay")
    .eq("tenant_id", TENANT)
    .eq("month", JULY_MONTH)
    .maybeSingle();
  const noteTag =
    "June correction: net_only_adjustment on 16 active staff (543.03); forfeited inactive 88.09 booked as Other Income.";
  const priorNotes = (mec?.notes ?? "").trim();
  const nextNotes = priorNotes.includes("June correction")
    ? priorNotes
    : priorNotes
      ? `${priorNotes}\n${noteTag}`
      : noteTag;
  const { error: mecErr } = await admin
    .from("month_end_close")
    .update({ notes: nextNotes })
    .eq("tenant_id", TENANT)
    .eq("month", JULY_MONTH);
  if (mecErr) throw mecErr;
  console.log("Updated July month_end_close notes");

  // Verify July adjustments
  const { data: verifyJuly } = await admin
    .from("payroll_processing")
    .select("employee_id, net_only_adjustment, net_pay, paye_tax, employee_ssnit")
    .eq("tenant_id", TENANT)
    .eq("payroll_month", JULY_MONTH)
    .gt("net_only_adjustment", 0);
  const verifySum = r2(
    (verifyJuly ?? []).reduce(
      (s, r) => s + (Number(r.net_only_adjustment) || 0),
      0,
    ),
  );
  console.log(
    `Verify July net_only_adjustment rows=${verifyJuly?.length} sum=${verifySum}`,
  );
  if ((verifyJuly?.length ?? 0) !== 16 || Math.abs(verifySum - EXPECTED_ACTIVE_TOTAL) > 0.05) {
    throw new Error("July net_only_adjustment verification failed");
  }

  const { data: verifyIncome } = await admin
    .from("income_register")
    .select("id, amount, amount_received, service_category, description")
    .eq("tenant_id", TENANT)
    .eq(
      "description",
      "June correction forfeited (DF0007, DF0015, DF0018, DF0019)",
    )
    .maybeSingle();
  console.log("Verify income:", verifyIncome);

  const { data: verifySal } = await admin
    .from("expense_register")
    .select("amount, payment_status, notes")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", AUTO_RECEIPT)
    .maybeSingle();
  console.log("Verify PAYROLL-SAL:", verifySal);

  await computeBs(admin, "AFTER");
  console.log("\nDONE. July payroll remains Open — David must lock when ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
