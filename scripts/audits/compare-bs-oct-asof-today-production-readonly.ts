/**
 * Production: OLD worktree vs NEW — Oct 2026 BS column only, referenceDate = today (UTC noon).
 * npx tsx scripts/audits/compare-bs-oct-asof-today-production-readonly.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const FY = 2026;
const OCT_INDEX = 9;
const TOL = 0.005;
const PROD_REF = "tvcurcnmasnocwdxzgvz";

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

function todayRefDateUtcNoon(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0),
  );
}

async function loadStack(codeRoot: string) {
  const base = resolve(codeRoot);
  const pageMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/balance-sheet-page-data.ts")).href
  );
  const standardMod = await import(
    pathToFileURL(join(base, "lib/finance/balance-sheet-standard-report.ts")).href
  );
  const utilsMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/balance-sheet-utils.ts")).href
  );
  return {
    fetchBalanceSheetPageData: pageMod.fetchBalanceSheetPageData,
    buildStandardBalanceSheetReport: standardMod.buildStandardBalanceSheetReport,
    dividendOptionsFromPageData: standardMod.dividendOptionsFromPageData ?? (() => ({})),
    getBalanceSheetMonthCheck: standardMod.getBalanceSheetMonthCheck,
    getBalanceSheetAmountForMonth: utilsMod.getBalanceSheetAmountForMonth,
    getBalanceCheckForPeriod: utilsMod.getBalanceCheckForPeriod,
    hasViewExtras: Boolean(standardMod.standardBalanceSheetReportExtrasForView),
    standardBalanceSheetReportExtrasForView:
      standardMod.standardBalanceSheetReportExtrasForView as
        | ((args: {
            viewAllBusinessUnits: boolean;
            activeBusinessUnitId: string | null;
            rawManualFinancialEntries?: unknown;
          }) => Record<string, unknown>)
        | undefined,
  };
}

type Stack = Awaited<ReturnType<typeof loadStack>>;

function reportExtras(
  stack: Stack,
  page: Awaited<ReturnType<Stack["fetchBalanceSheetPageData"]>>,
  viewAll: boolean,
  buId: string | null,
) {
  if (stack.hasViewExtras && stack.standardBalanceSheetReportExtrasForView) {
    return stack.standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: viewAll,
      activeBusinessUnitId: buId,
      rawManualFinancialEntries: viewAll ? page.initialRawManualEntries : undefined,
    });
  }
  return {
    allBusinessUnitsDirectorsLoan: viewAll,
    rawManualFinancialEntries: viewAll ? page.initialRawManualEntries : undefined,
    interUnitTransferScope: buId
      ? { mode: "unit" as const, businessUnitId: buId }
      : { mode: "exclude" as const },
    balanceSheetBusinessUnitId: viewAll ? null : buId,
    ...stack.dividendOptionsFromPageData(page, buId ? { mode: "unit", id: buId } : { mode: "default" }),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const repoRoot = resolve(process.cwd());
  const oldRoot = resolve(repoRoot, ".worktrees/bs-regression-old");
  if (!existsSync(join(oldRoot, "app/dashboard/finance/balance-sheet-utils.ts"))) {
    throw new Error(`Missing OLD worktree at ${oldRoot}`);
  }

  let loaded = false;
  for (const f of [".env.local.backup", ".env.vercel.production.local", ".env.production.local"]) {
    const p = resolve(repoRoot, f);
    if (existsSync(p)) {
      loadEnv(p);
      loaded = true;
      console.log(`Loaded production env from ${f}`);
      break;
    }
  }
  if (!loaded) throw new Error("No production env file found");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) {
    throw new Error(`Refusing: expected production ref ${PROD_REF}`);
  }

  const refDate = todayRefDateUtcNoon();
  console.log("referenceDate (UTC noon today):", refDate.toISOString());

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [oldStack, newStack] = await Promise.all([
    loadStack(oldRoot),
    loadStack(repoRoot),
  ]);

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");

  type Diff = {
    tenant: string;
    scope: string;
    key: string;
    old: number;
    new: number;
    delta: number;
  };
  const diffs: Diff[] = [];
  const balanceNew: Array<{
    tenant: string;
    scope: string;
    diff: number;
    balanced: boolean;
  }> = [];

  for (const tenant of tenants ?? []) {
    const { data: bus } = await admin
      .from("business_units")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .order("name");

    const scopes: Array<{ label: string; viewAll: boolean; buId: string | null }> = [
      { label: "All businesses", viewAll: true, buId: null },
      ...(bus ?? []).map((b) => ({
        label: String(b.name),
        viewAll: false,
        buId: b.id,
      })),
      { label: "Untagged", viewAll: false, buId: null },
    ];

    for (const s of scopes) {
      const fetchOpts = {
        viewAllBusinessUnits: s.viewAll,
        activeBusinessUnitId: s.buId,
        referenceDate: refDate,
      };
      const [oldPage, newPage] = await Promise.all([
        oldStack.fetchBalanceSheetPageData(admin, tenant.id, fetchOpts),
        newStack.fetchBalanceSheetPageData(admin, tenant.id, fetchOpts),
      ]);
      if (oldPage.fetchError || newPage.fetchError) {
        console.warn("fetch error", tenant.name, s.label, oldPage.fetchError, newPage.fetchError);
        continue;
      }

      const oldExtras = reportExtras(oldStack, oldPage, s.viewAll, s.buId);
      const newExtras = reportExtras(newStack, newPage, s.viewAll, s.buId);
      const oldReport = oldStack.buildStandardBalanceSheetReport(
        oldPage,
        tenant.id,
        FY,
        oldExtras,
      );
      const newReport = newStack.buildStandardBalanceSheetReport(
        newPage,
        tenant.id,
        FY,
        newExtras,
      );

      const newCheck = newStack.getBalanceSheetMonthCheck(newReport, OCT_INDEX);
      balanceNew.push({
        tenant: tenant.name,
        scope: s.label,
        diff: newCheck.difference,
        balanced: newCheck.isBalanced,
      });

      const keys = newReport.rows.filter((r) => r.kind !== "section").map((r) => r.key);
      for (const key of keys) {
        const orow = oldReport.rows.find((r) => r.key === key);
        const nrow = newReport.rows.find((r) => r.key === key);
        const oldAmt = round2(oldStack.getBalanceSheetAmountForMonth(orow!, OCT_INDEX));
        const newAmt = round2(newStack.getBalanceSheetAmountForMonth(nrow!, OCT_INDEX));
        const delta = round2(newAmt - oldAmt);
        if (Math.abs(delta) >= TOL) {
          diffs.push({
            tenant: tenant.name,
            scope: s.label,
            key,
            old: oldAmt,
            new: newAmt,
            delta,
          });
        }
      }
    }
  }

  const unbalanced = balanceNew.filter((b) => !b.balanced);
  const outPath = resolve(repoRoot, "scripts/audits/output/bs-oct-asof-today-production.json");
  mkdirSync(resolve(repoRoot, "scripts/audits/output"), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        referenceDate: refDate.toISOString(),
        month: "Oct 2026 (index 9)",
        diffCount: diffs.length,
        diffs,
        newCodeBalanceChecks: balanceNew,
        unbalancedNewCount: unbalanced.length,
        unbalancedNew: unbalanced,
      },
      null,
      2,
    ),
  );

  console.log("\n=== Oct 2026 column, ref=today, production OLD vs NEW ===");
  console.log("Line diffs:", diffs.length);
  for (const d of diffs) console.log(JSON.stringify(d));
  console.log("\nNEW code balance (Oct, ref=today):");
  for (const b of balanceNew) {
    console.log(
      `${b.tenant} | ${b.scope} | diff=${b.diff} | balanced=${b.balanced}`,
    );
  }
  console.log(`\nWrote ${outPath}`);
  if (unbalanced.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
