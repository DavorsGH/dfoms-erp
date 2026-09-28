/**
 * Read-only: emit Davors tenant BS integrity imbalances as JSON (for baseline vs current diff).
 * npx tsx scripts/compare-bs-integrity-davors-staging.ts --env-file .env.staging.local --label current
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const labelArg = process.argv.find((a) => a.startsWith("--label="));
const labelFlagIdx = process.argv.indexOf("--label");
const label =
  labelArg?.slice("--label=".length) ??
  (labelFlagIdx >= 0 ? process.argv[labelFlagIdx + 1] : "unknown");

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

let envFile = ".env.local";
const envEq = process.argv.find((a) => a.startsWith("--env-file="));
if (envEq) envFile = envEq.slice("--env-file=".length);
const envIdx = process.argv.indexOf("--env-file");
if (envIdx >= 0 && process.argv[envIdx + 1]) envFile = process.argv[envIdx + 1]!;
loadEnv(resolve(envFile));

import { createClient } from "@supabase/supabase-js";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FISCAL_YEAR = 2026;
const REFERENCE_DATE = new Date("2026-09-30T12:00:00.000Z");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env");
  }

  const admin = createClient(url, key);
  const result = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: DAVORS_TENANT_ID, name: "Davors" },
    FISCAL_YEAR,
    REFERENCE_DATE,
  );

  const rows = result.scopeResults.flatMap((scope) =>
    scope.imbalances.map((imb) => ({
      scope: scope.scope,
      businessUnitId: scope.businessUnitId,
      businessUnitName: scope.businessUnitName,
      monthIndex: imb.monthIndex,
      monthLabel: imb.monthLabel,
      diff: Math.round(imb.diff * 100) / 100,
      totalAssets: Math.round(imb.totalAssets * 100) / 100,
      totalLiabilitiesAndEquity:
        Math.round(imb.totalLiabilitiesAndEquity * 100) / 100,
    })),
  );

  console.log(
    JSON.stringify(
      {
        label,
        gitHead: process.env.GIT_HEAD ?? null,
        fiscalYear: FISCAL_YEAR,
        referenceDate: REFERENCE_DATE.toISOString().slice(0, 10),
        status: result.status,
        maxAbsDiff: result.maxAbsDiff,
        fetchError: result.fetchError,
        imbalanceCount: rows.length,
        rows,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
