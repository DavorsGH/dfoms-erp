/**
 * Staging: Inter-unit transfers — BS/cash scopes, CRUD, tenant isolation.
 *
 * Usage: npx tsx scripts/test-business-unit-transfers-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TEST_AMOUNT_1 = 100;
const TEST_AMOUNT_2 = 150;
const TEST_DESC = "Inter-unit transfer staging test (disposable)";

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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function snapshotBs(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  viewAll: boolean,
  activeBuId: string | null,
  year: number,
  monthIndex: number,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, {
    viewAllBusinessUnits: viewAll,
    activeBusinessUnitId: activeBuId,
    includePayrollLiveRecalc: false,
  });
  const extras = viewAll
    ? {
        allBusinessUnitsDirectorsLoan: true,
        rawManualFinancialEntries: data.initialRawManualEntries,
        interUnitTransferScope: { mode: "exclude" as const },
      }
    : {
        interUnitTransferScope: {
          mode: "unit" as const,
          businessUnitId: activeBuId!,
        },
      };
  const report = buildStandardBalanceSheetReport(
    data,
    tenantId,
    year,
    extras,
  );
  const check = getBalanceSheetMonthCheck(report, monthIndex);
  const cash = getBalanceSheetAmountForMonth(
    report.rows.find((r) => r.key === "cash")!,
    monthIndex,
  );
  const dueFrom = getBalanceSheetAmountForMonth(
    report.rows.find((r) => r.key === "due-from-other-business-units") ?? {
      amounts: [],
      key: "",
      label: "",
      kind: "data",
    },
    monthIndex,
  );
  const dueTo = getBalanceSheetAmountForMonth(
    report.rows.find((r) => r.key === "due-to-other-business-units") ?? {
      amounts: [],
      key: "",
      label: "",
      kind: "data",
    },
    monthIndex,
  );
  return { cash, dueFrom, dueTo, balanced: check.isBalanced, diff: check.difference };
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url?.includes(STAGING_REF), "Run against staging .env.local");
  assert(key, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: units, error: unitsError } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS)
    .order("name");
  assert(!unitsError, unitsError?.message ?? "units");
  const facilities = units!.find((u) =>
    String(u.name).toLowerCase().includes("facilities"),
  );
  const technologies = units!.find((u) =>
    String(u.name).toLowerCase().includes("technologies"),
  );
  assert(facilities?.id && technologies?.id, "Need Davors Facilities + Technologies BUs");

  const transferDate = new Date().toISOString().slice(0, 10);
  const year = Number(transferDate.slice(0, 4));
  const monthIndex = Number(transferDate.slice(5, 7)) - 1;

  const beforeAll = await snapshotBs(admin, DAVORS, true, null, year, monthIndex);
  const beforeFac = await snapshotBs(
    admin,
    DAVORS,
    false,
    facilities.id,
    year,
    monthIndex,
  );
  const beforeTech = await snapshotBs(
    admin,
    DAVORS,
    false,
    technologies.id,
    year,
    monthIndex,
  );

  const { data: inserted, error: insertError } = await admin
    .from("business_unit_transfers")
    .insert({
      tenant_id: DAVORS,
      transfer_date: transferDate,
      from_business_unit_id: facilities.id,
      to_business_unit_id: technologies.id,
      amount: TEST_AMOUNT_1,
      description: TEST_DESC,
      reference: "IUT-STAGING-TEST",
    })
    .select("id")
    .single();
  assert(!insertError, insertError?.message ?? "insert");
  const transferId = inserted!.id as string;

  const after100All = await snapshotBs(admin, DAVORS, true, null, year, monthIndex);
  const after100Fac = await snapshotBs(
    admin,
    DAVORS,
    false,
    facilities.id,
    year,
    monthIndex,
  );
  const after100Tech = await snapshotBs(
    admin,
    DAVORS,
    false,
    technologies.id,
    year,
    monthIndex,
  );

  assert(after100All.balanced, `All-units BS imbalanced: ${after100All.diff}`);
  assert(
    round2(after100All.cash - beforeAll.cash) === 0,
    `All-units cash changed: ${beforeAll.cash} → ${after100All.cash}`,
  );
  assert(after100Fac.balanced, `Facilities BS imbalanced: ${after100Fac.diff}`);
  assert(
    round2(after100Fac.cash - beforeFac.cash) === -TEST_AMOUNT_1,
    `Facilities cash delta ${after100Fac.cash - beforeFac.cash}`,
  );
  assert(
    round2(after100Fac.dueFrom - beforeFac.dueFrom) === TEST_AMOUNT_1,
    `Facilities due-from delta ${after100Fac.dueFrom - beforeFac.dueFrom}`,
  );
  assert(after100Tech.balanced, `Technologies BS imbalanced: ${after100Tech.diff}`);
  assert(
    round2(after100Tech.cash - beforeTech.cash) === TEST_AMOUNT_1,
    `Technologies cash delta ${after100Tech.cash - beforeTech.cash}`,
  );
  assert(
    round2(after100Tech.dueTo - beforeTech.dueTo) === TEST_AMOUNT_1,
    `Technologies due-to delta ${after100Tech.dueTo - beforeTech.dueTo}`,
  );

  const { error: updateError } = await admin
    .from("business_unit_transfers")
    .update({ amount: TEST_AMOUNT_2 })
    .eq("id", transferId)
    .eq("tenant_id", DAVORS);
  assert(!updateError, updateError?.message ?? "update");

  const after150Fac = await snapshotBs(
    admin,
    DAVORS,
    false,
    facilities.id,
    year,
    monthIndex,
  );
  assert(
    round2(after150Fac.cash - beforeFac.cash) === -TEST_AMOUNT_2,
    `After edit Facilities cash delta ${after150Fac.cash - beforeFac.cash}`,
  );
  assert(
    round2(after150Fac.dueFrom - beforeFac.dueFrom) === TEST_AMOUNT_2,
    `After edit Facilities due-from ${after150Fac.dueFrom - beforeFac.dueFrom}`,
  );

  const { error: deleteError } = await admin
    .from("business_unit_transfers")
    .delete()
    .eq("id", transferId)
    .eq("tenant_id", DAVORS);
  assert(!deleteError, deleteError?.message ?? "delete");

  const afterDeleteFac = await snapshotBs(
    admin,
    DAVORS,
    false,
    facilities.id,
    year,
    monthIndex,
  );
  assert(
    round2(afterDeleteFac.cash) === round2(beforeFac.cash),
    "Facilities cash not restored after delete",
  );
  assert(
    round2(afterDeleteFac.dueFrom) === round2(beforeFac.dueFrom),
    "Facilities due-from not restored after delete",
  );

  const { count: caantaCount } = await admin
    .from("business_units")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", CAANTA);
  console.log(`Caanta business unit count: ${caantaCount ?? "?"}`);

  const { data: crossRead } = await admin
    .from("business_unit_transfers")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("description", TEST_DESC);
  assert((crossRead ?? []).length === 0, "Test row should be deleted");

  const { error: crossInsert } = await admin.from("business_unit_transfers").insert({
    tenant_id: CAANTA,
    transfer_date: transferDate,
    from_business_unit_id: facilities.id,
    to_business_unit_id: technologies.id,
    amount: 1,
    description: "Cross-tenant should fail",
  });
  assert(crossInsert, "Expected cross-tenant BU insert to be rejected");

  console.log(
    JSON.stringify(
      {
        transferDate,
        year,
        monthIndex,
        before: { all: beforeAll, facilities: beforeFac, technologies: beforeTech },
        after100: {
          all: after100All,
          facilities: after100Fac,
          technologies: after100Tech,
        },
        after150Fac,
        afterDeleteFac,
        caantaUnitCount: caantaCount,
        crossInsertRejected: Boolean(crossInsert?.message),
      },
      null,
      2,
    ),
  );
  console.log("\nPASS: Inter-unit transfers staging checks completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
