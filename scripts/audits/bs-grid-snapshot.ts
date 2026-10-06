/**
 * Emit balance-sheet month checks Jan–Dec for all tenants/scopes (read-only).
 * Used for BEFORE (origin/main worktree) vs AFTER (working tree) production dry-runs.
 *
 * npx tsx scripts/audits/bs-grid-snapshot.ts --out scripts/audits/output/foo.json
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const MONTHS = Array.from({ length: 12 }, (_, i) => i);
const TOL = 0.005;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function loadBalanceSheetModules(codeRoot: string) {
  const base = resolve(codeRoot);
  const pageData = await import(
    pathToFileURL(
      join(base, "app/dashboard/finance/balance-sheet-page-data.ts"),
    ).href
  );
  const standardPath = join(
    base,
    "lib/finance/balance-sheet-standard-report.ts",
  );
  if (existsSync(standardPath)) {
    const standard = await import(pathToFileURL(standardPath).href);
    return {
      fetchBalanceSheetPageData:
        pageData.fetchBalanceSheetPageData as typeof import("../../app/dashboard/finance/balance-sheet-page-data").fetchBalanceSheetPageData,
      buildReport: (data: BalanceSheetPageData, tenantId: string, fy: number, all: boolean) =>
        standard.buildStandardBalanceSheetReport(
          data,
          tenantId,
          fy,
          all
            ? {
                allBusinessUnitsDirectorsLoan: true,
                rawManualFinancialEntries: data.initialRawManualEntries,
              }
            : {},
        ),
      getMonthCheck: standard.getBalanceSheetMonthCheck as (report: unknown, mi: number) => {
        difference: number;
        isBalanced: boolean;
      },
    };
  }

  const legacy = await import(
    pathToFileURL(join(base, "app/dashboard/finance/balance-sheet-utils.ts")).href
  );
  return {
    fetchBalanceSheetPageData:
      pageData.fetchBalanceSheetPageData as typeof import("../../app/dashboard/finance/balance-sheet-page-data").fetchBalanceSheetPageData,
    buildReport: (data: BalanceSheetPageData, tenantId: string, fy: number) =>
      legacy.buildBalanceSheetReport(
        data.initialIncomeEntries,
        data.initialExpenseEntries,
        data.initialFixedAssets,
        data.initialPayableEntries,
        data.initialCapitalContributions,
        data.initialCashFlowExpenseEntries,
        data.initialPayrollHistory,
        data.initialMonthEndCloseNetPay,
        fy,
        data.initialInventoryBalanceSheet,
        data.initialManualEntries,
        data.initialTaxLedgerEntries,
        data.initialWelfareFundEntries,
        { tenantId },
      ),
    getMonthCheck: legacy.getBalanceCheckForPeriod as (
      report: unknown,
      mi: number,
    ) => { difference: number; isBalanced: boolean },
  };
}

type BalanceSheetPageData = Awaited<
  ReturnType<
    Awaited<ReturnType<typeof loadBalanceSheetModules>>["fetchBalanceSheetPageData"]
  >
>;

function monthDiffs(
  data: BalanceSheetPageData,
  tenantId: string,
  all: boolean,
  buildReport: Awaited<ReturnType<typeof loadBalanceSheetModules>>["buildReport"],
  getMonthCheck: Awaited<ReturnType<typeof loadBalanceSheetModules>>["getMonthCheck"],
) {
  const report = buildReport(data, tenantId, FY, all);
  return MONTHS.map((mi) => {
    const c = getMonthCheck(report, mi);
    return {
      monthIndex: mi,
      difference: c.difference,
      isBalanced: c.isBalanced,
    };
  });
}

function maxAbsDiff(months: Array<{ difference: number }>) {
  return Math.max(...months.map((m) => Math.abs(m.difference)), 0);
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outPath =
    outArg >= 0 && process.argv[outArg + 1]
      ? resolve(process.argv[outArg + 1])
      : resolve(process.cwd(), "scripts/audits/output/bs-grid-snapshot.json");
  const codeRootArg = process.argv.indexOf("--code-root");
  const codeRoot =
    codeRootArg >= 0 && process.argv[codeRootArg + 1]
      ? resolve(process.argv[codeRootArg + 1])
      : resolve(process.cwd());

  const { fetchBalanceSheetPageData, buildReport, getMonthCheck } =
    await loadBalanceSheetModules(codeRoot);

  loadEnv(".env.local.production-backup-2026-08-25");
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_REF)) {
    throw new Error("Refusing non-production env");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");
  const grid: Array<Record<string, unknown>> = [];

  for (const tenant of tenants ?? []) {
    const { data: bus } = await admin
      .from("business_units")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .order("name");

    const scopes: Array<{
      scope: string;
      fetch: Parameters<typeof fetchBalanceSheetPageData>[2];
      all: boolean;
    }> = [
      {
        scope: "All businesses",
        fetch: { viewAllBusinessUnits: true, dateRange: null },
        all: true,
      },
    ];
    if ((bus ?? []).length === 0) {
      scopes.push({
        scope: "Whole business (NULL BU)",
        fetch: {
          viewAllBusinessUnits: false,
          activeBusinessUnitId: null,
          dateRange: null,
        },
        all: false,
      });
    } else {
      scopes.push({
        scope: "Untagged (NULL BU)",
        fetch: {
          viewAllBusinessUnits: false,
          activeBusinessUnitId: null,
          dateRange: null,
        },
        all: false,
      });
      for (const bu of bus ?? []) {
        scopes.push({
          scope: String(bu.name),
          fetch: {
            viewAllBusinessUnits: false,
            activeBusinessUnitId: bu.id,
            dateRange: null,
          },
          all: false,
        });
      }
    }

    for (const s of scopes) {
      const data = await fetchBalanceSheetPageData(admin, tenant.id, s.fetch);
      if (data.fetchError) {
        grid.push({
          tenant: tenant.name,
          tenantId: tenant.id,
          scope: s.scope,
          error: data.fetchError,
        });
        continue;
      }
      let months: Array<{ monthIndex: number; difference: number; isBalanced: boolean }>;
      try {
        months = monthDiffs(data, tenant.id, s.all, buildReport, getMonthCheck);
      } catch (error) {
        grid.push({
          tenant: tenant.name,
          tenantId: tenant.id,
          scope: s.scope,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      grid.push({
        tenant: tenant.name,
        tenantId: tenant.id,
        scope: s.scope,
        maxAbsDiff: maxAbsDiff(months),
        months,
      });
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ fy: FY, tolerance: TOL, grid }, null, 2));
  console.log(`Wrote ${grid.length} scope rows → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
