/**
 * Read-only: simulate retagging mis-tagged director's loan rows on production Davors
 * (Technologies → Facilities) and compare BS checks Jan–Dec 2026.
 *
 * Does NOT write to production. Uses in-memory BU override on fetched rows.
 *
 * npx tsx scripts/audits/dry-run-davors-retag-production-readonly.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import type { BalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const MONTHS = Array.from({ length: 12 }, (_, i) => i);
const TOL = 0.005;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function fmtDiffs(diffs: number[]) {
  return (
    MONTHS.map((mi) =>
      Math.abs(diffs[mi]!) >= TOL ? `${mi + 1}:${diffs[mi]!.toFixed(2)}` : null,
    )
      .filter(Boolean)
      .join(", ") || "balanced"
  );
}

function monthDiffs(
  data: BalanceSheetPageData,
  tenantId: string,
  all: boolean,
): number[] {
  const report = buildStandardBalanceSheetReport(
    data,
    tenantId,
    FY,
    all
      ? {
          allBusinessUnitsDirectorsLoan: true,
          rawManualFinancialEntries: data.initialRawManualEntries,
        }
      : {},
  );
  return MONTHS.map((mi) => getBalanceSheetMonthCheck(report, mi).difference);
}

function retagBu<T extends { business_unit_id?: string | null }>(
  rows: T[],
  fromBu: string,
  toBu: string,
): T[] {
  return rows.map((row) =>
    row.business_unit_id === fromBu ? { ...row, business_unit_id: toBu } : row,
  );
}

function applySimulatedRetag(
  data: BalanceSheetPageData,
  fromBu: string,
  toBu: string,
): BalanceSheetPageData {
  const dl = retagBu(data.initialDirectorsLoanLedgerEntries ?? [], fromBu, toBu);
  const rep = retagBu(data.initialDirectorsLoanRepayments ?? [], fromBu, toBu);
  const raw = retagBu(data.initialRawManualEntries ?? [], fromBu, toBu);
  const manuals = retagBu(data.initialManualEntries ?? [], fromBu, toBu);
  return {
    ...data,
    initialDirectorsLoanLedgerEntries: dl,
    initialDirectorsLoanRepayments: rep,
    initialRawManualEntries: raw,
    initialManualEntries: manuals,
  };
}

async function main() {
  loadEnv(".env.local.production-backup-2026-08-25");
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_REF)) {
    throw new Error("Refusing non-production env");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", TENANT)
    .order("name");

  const tech = (bus ?? []).find((b) => /technolog/i.test(b.name));
  const fac = (bus ?? []).find((b) => /facilities/i.test(b.name));
  if (!tech || !fac) {
    console.log("Technologies or Facilities BU not found on production Davors.");
    return;
  }

  console.log(`Simulate retag ${tech.name} (${tech.id}) → ${fac.name} (${fac.id})\n`);

  const scopes: Array<{
    label: string;
    fetch: Parameters<typeof fetchBalanceSheetPageData>[2];
    all: boolean;
  }> = [
    { label: "All businesses", fetch: { viewAllBusinessUnits: true, dateRange: null }, all: true },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: bu.id,
        dateRange: null,
      },
      all: false,
    })),
  ];

  for (const scope of scopes) {
    const beforeData = await fetchBalanceSheetPageData(admin, TENANT, scope.fetch);
    const afterData = applySimulatedRetag(beforeData, tech.id, fac.id);
    const before = monthDiffs(beforeData, TENANT, scope.all);
    const after = monthDiffs(afterData, TENANT, scope.all);
    console.log(scope.label);
    console.log(`  BEFORE: ${fmtDiffs(before)}`);
    console.log(`  AFTER:  ${fmtDiffs(after)}`);
  }

  console.log("\nProposed SQL (DO NOT RUN without approval):");
  console.log(`UPDATE public.directors_loan_entries SET business_unit_id = '${fac.id}'::uuid`);
  console.log(`  WHERE tenant_id = '${TENANT}'::uuid AND business_unit_id = '${tech.id}'::uuid;`);
  console.log(`UPDATE public.directors_loan_repayments SET business_unit_id = '${fac.id}'::uuid`);
  console.log(`  WHERE tenant_id = '${TENANT}'::uuid AND business_unit_id = '${tech.id}'::uuid;`);
  console.log(`UPDATE public.manual_financial_entries SET business_unit_id = '${fac.id}'::uuid`);
  console.log(`  WHERE tenant_id = '${TENANT}'::uuid AND business_unit_id = '${tech.id}'::uuid;`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
