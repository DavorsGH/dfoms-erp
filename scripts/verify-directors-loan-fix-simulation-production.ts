/**
 * Read-only production: in-memory data fix + balance sheet proof (no writes).
 *
 *   npx tsx scripts/verify-directors-loan-fix-simulation-production.ts --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  BALANCE_TOLERANCE,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildNetPayByPayrollMonth } from "../app/dashboard/finance/accrued-wages-utils";
import { filterManualEntriesForYear } from "../app/dashboard/finance/cash-flow-utils";
import type { ManualFinancialEntryRecord } from "../app/dashboard/finance/manual-financial-entries-utils";
import {
  patchManualFinancialEntriesForDirectorLoanLedger,
  type DirectorsLoanLedgerEntry,
} from "../app/dashboard/finance/directors-loan-ledger-utils";
import {
  buildReportBundle,
  compareSnapshots,
  snapshotNewPath,
  PARITY_FY,
  TOLERANCE,
} from "./lib/directors-loan-migration-parity";
import { buildMonthlyCashComponentsAsDeployed } from "./lib/cash-movement-deployed-subtract";
import {
  buildClosingCashByMonth,
  resolveJanuaryOpeningCashBalance,
  type CashMovementInputs,
} from "../app/dashboard/finance/cash-movement-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const LOGISTICS_BU = "2ae591d2-0f89-44d0-83af-1133cfe7a32c";
const FACILITIES_BU = "608f81b5-38be-4756-8a52-8279c859b07c";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function loadEnv(file: string) {
  for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

type Scope = {
  label: string;
  buMode: "all" | "default" | "unit";
  fetch: Parameters<typeof fetchBalanceSheetPageData>[2];
  unitId?: string | null;
};

async function scopesForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Scope[]> {
  const { data: units } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const scopes: Scope[] = [
    {
      label: "all",
      buMode: "all",
      fetch: { viewAllBusinessUnits: true, activeBusinessUnitId: null },
      unitId: null,
    },
    {
      label: "default",
      buMode: "default",
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: null },
      unitId: null,
    },
  ];
  for (const unit of units ?? []) {
    scopes.push({
      label: String(unit.name ?? unit.id),
      buMode: "unit",
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: unit.id as string,
      },
      unitId: unit.id as string,
    });
  }
  return scopes;
}

function manualForScope(
  patched: ManualFinancialEntryRecord[],
  scope: Scope,
): ManualFinancialEntryRecord[] {
  if (scope.buMode === "all") return patched;
  if (scope.buMode === "default") {
    return patched.filter((m) => (m.business_unit_id ?? null) === null);
  }
  return patched.filter((m) => m.business_unit_id === scope.unitId);
}

function maxImbalance(report: ReturnType<typeof buildBalanceSheetReport>, months = 12) {
  let max = 0;
  const bad: Array<{ month: string; diff: number }> = [];
  for (let i = 0; i < months; i += 1) {
    const check = getBalanceCheckForPeriod(report, i);
    const abs = Math.abs(check.difference);
    if (abs > BALANCE_TOLERANCE) {
      bad.push({ month: MONTHS[i]!, diff: r2(check.difference) });
    }
    if (abs > max) max = abs;
  }
  return { max, bad };
}

function buildBsWithCustomCash(
  data: Awaited<ReturnType<typeof fetchBalanceSheetPageData>>,
  scope: Scope,
  manualOverride: ManualFinancialEntryRecord[],
  cashBuilder: typeof buildMonthlyCashComponentsAsDeployed | null,
) {
  const manualYear = filterManualEntriesForYear(manualOverride, PARITY_FY);
  const staffSalary = buildNetPayByPayrollMonth(
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
  );
  const ledger = data.initialDirectorsLoanLedgerEntries ?? [];
  const opts = {
    tenantId: data.tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: ledger,
    allBusinessUnitsDirectorsLoan: scope.buMode === "all",
    rawManualFinancialEntries:
      scope.buMode === "all"
        ? (data.initialRawManualEntries as ManualFinancialEntryRecord[])
        : undefined,
  };

  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    PARITY_FY,
    data.initialInventoryBalanceSheet,
    manualYear,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    opts,
  );

  if (!cashBuilder) {
    return report;
  }

  const cashInputs: CashMovementInputs = {
    tenantId: data.tenantId,
    incomeEntries: data.initialCashFlowIncomeEntries,
    expenseEntries: data.initialCashFlowExpenseEntries,
    capitalContributions: data.initialCapitalContributions,
    fixedAssets: data.initialFixedAssets,
    rawMaterialCashPurchases: data.initialInventoryBalanceSheet.cashPurchases ?? [],
    productCashPurchases: data.initialInventoryBalanceSheet.productCashPurchases ?? [],
    inventoryConfig: data.initialInventoryBalanceSheet.config,
    manualEntries: manualYear,
    accountsPayableSettlements: data.initialPayableEntries,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: ledger,
    staffSalaryNetByPayrollMonth: staffSalary,
  };
  const components = cashBuilder(cashInputs, PARITY_FY);
  const januaryOpening = resolveJanuaryOpeningCashBalance(manualYear, PARITY_FY);
  const cash = buildClosingCashByMonth(components.netMovement, januaryOpening);

  const cashRow = report.rows.find((row) => row.key === "cash");
  if (cashRow && cashRow.kind === "line") {
    const deltaByMonth = cash.map((value, index) =>
      r2(value - (cashRow.amounts[index] ?? 0)),
    );
    cashRow.amounts = cash;
    for (const row of report.rows) {
      if (row.kind === "line" && row.key === "total-assets") {
        row.amounts = row.amounts.map((value, index) =>
          r2(value + (deltaByMonth[index] ?? 0)),
        );
      }
    }
    report.totalAssets = report.totalAssets.map((value, index) =>
      r2(value + (deltaByMonth[index] ?? 0)),
    );
  }

  return report;
}

async function main() {
  const envFile =
    process.argv.includes("--env-file") &&
    process.argv[process.argv.indexOf("--env-file") + 1]
      ? process.argv[process.argv.indexOf("--env-file") + 1]!
      : ".env.local.backup";
  loadEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: not production");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: tenants } = await admin.from("tenants").select("id, name, status");
  const failures: string[] = [];
  const currentImbalances: Array<{
    tenant: string;
    scope: string;
    bad: Array<{ month: string; diff: number }>;
  }> = [];

  console.log("\n=== CURRENT production BS (live DB, new code in repo, unpatched manuals) ===\n");

  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const tenantName = String(tenant.name);
    const { data: manuals } = await admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", tenantId);
    const patchedAll = patchManualFinancialEntriesForDirectorLoanLedger(
      (manuals ?? []) as ManualFinancialEntryRecord[],
      ((await admin.from("directors_loan_entries").select("*").eq("tenant_id", tenantId))
        .data ?? []) as DirectorsLoanLedgerEntry[],
      PARITY_FY,
    );

    const scopes = await scopesForTenant(admin, tenantId);

    for (const scope of scopes) {
      const data = await fetchBalanceSheetPageData(admin, tenantId, scope.fetch);
      if (data.fetchError) continue;

      const currentReport = buildBsWithCustomCash(
        data,
        scope,
        data.initialManualEntries as ManualFinancialEntryRecord[],
        null,
      );
      const current = maxImbalance(currentReport);
      if (current.bad.length > 0) {
        currentImbalances.push({
          tenant: tenantName,
          scope: scope.label,
          bad: current.bad,
        });
      }

      const scopedPatched = manualForScope(patchedAll, scope);
      const fixedReport = buildBsWithCustomCash(
        data,
        scope,
        scopedPatched,
        null,
      );
      const fixed = maxImbalance(fixedReport);
      if (fixed.bad.length > 0) {
        failures.push(
          `${tenantName} | ${scope.label} | in-memory fix still imbalanced: ${JSON.stringify(fixed.bad)}`,
        );
      }

      if (tenantId === DAVORS && scope.unitId === FACILITIES_BU) {
        const preMigration = buildReportBundle(
          data,
          "unit",
          PARITY_FY,
          [],
          undefined,
          FACILITIES_BU,
        );
        const postFix = buildReportBundle(
          data,
          "unit",
          PARITY_FY,
          data.initialDirectorsLoanLedgerEntries ?? [],
          scopedPatched,
          FACILITIES_BU,
        );
        const facDiffs = compareSnapshots(
          snapshotNewPath(preMigration),
          snapshotNewPath(postFix),
        ).filter(
          (d) =>
            d.key.startsWith("BS:") &&
            d.key !== "BS:balance-check-diff" &&
            Math.abs(d.delta) > TOLERANCE,
        );
        if (facDiffs.length > 0) {
          failures.push(
            `Davors Facilities BS ≠ pre-migration snapshot: ${facDiffs.length} deltas (first: ${facDiffs[0]?.key} M${facDiffs[0]?.month} Δ${facDiffs[0]?.delta})`,
          );
        }
      }

      if (tenantId === DAVORS && scope.unitId === LOGISTICS_BU) {
        const sep = 8;
        const cashNow = getBalanceSheetAmountForMonth(
          currentReport.rows.find((r) => r.key === "cash")!,
          sep,
        );
        const cashFixed = getBalanceSheetAmountForMonth(
          fixedReport.rows.find((r) => r.key === "cash")!,
          sep,
        );
        const dueFixed = getBalanceSheetAmountForMonth(
          fixedReport.rows.find((r) => r.key === "due-from-director")!,
          sep,
        );
        if (r2(cashNow - cashFixed) !== 8000) {
          failures.push(
            `Logistics Sep cash drop expected 8000, got ${r2(cashNow - cashFixed)}`,
          );
        }
        if (dueFixed < 7999.99) {
          failures.push(`Logistics Sep due-from-director expected 8000, got ${dueFixed}`);
        }
      }
    }
  }

  for (const row of currentImbalances) {
    console.log(`${row.tenant} | ${row.scope}: ${JSON.stringify(row.bad)}`);
  }
  if (currentImbalances.length === 0) {
    console.log("(no imbalances > tolerance on current DB)");
  }

  console.log("\n=== Davors: in-memory data fix + DEPLOYED cash subtract (production app today) ===\n");
  const davorScopes = [
    { label: "All Businesses", fetch: { viewAllBusinessUnits: true, activeBusinessUnitId: null }, buMode: "all" as const },
    {
      label: "Davors Facilities",
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: FACILITIES_BU },
      buMode: "unit" as const,
      unitId: FACILITIES_BU,
    },
    {
      label: "Davors Logistics",
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: LOGISTICS_BU },
      buMode: "unit" as const,
      unitId: LOGISTICS_BU,
    },
  ];
  const { data: davorManuals } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", DAVORS);
  const { data: davorLedger } = await admin
    .from("directors_loan_entries")
    .select("*")
    .eq("tenant_id", DAVORS);
  const davorPatched = patchManualFinancialEntriesForDirectorLoanLedger(
    (davorManuals ?? []) as ManualFinancialEntryRecord[],
    (davorLedger ?? []) as DirectorsLoanLedgerEntry[],
    PARITY_FY,
  );

  for (const ds of davorScopes) {
    const data = await fetchBalanceSheetPageData(admin, DAVORS, ds.fetch);
    const scope: Scope = {
      label: ds.label,
      buMode: ds.buMode,
      fetch: ds.fetch,
      unitId: "unitId" in ds ? ds.unitId : null,
    };
    const scopedPatched = manualForScope(davorPatched, scope);
    const deployedReport = buildBsWithCustomCash(
      data,
      scope,
      scopedPatched,
      buildMonthlyCashComponentsAsDeployed,
    );
    const dep = maxImbalance(deployedReport);
    console.log(
      `${ds.label}: ${dep.bad.length === 0 ? "balanced all months" : `imbalance ${JSON.stringify(dep.bad)}`}`,
    );
  }

  console.log("\n=== In-memory data fix + NEW code (all tenants / scopes) ===\n");
  if (failures.length === 0) {
    console.log("PASS — every tenant scope Jan–Dec 2026 balanced after in-memory patch.");
  } else {
    console.log("FAIL:");
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
