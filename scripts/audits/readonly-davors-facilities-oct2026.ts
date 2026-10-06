/**
 * Read-only: Davors Facilities Oct 2026 BS (standard report path).
 * npx tsx scripts/audits/readonly-davors-facilities-oct2026.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const TENANT = "00000001-0000-4000-8000-000000000001";
const BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const FY = 2026;
const OCT = 9;

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

async function main() {
  let envFile = ".env.staging.local";
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  loadEnv(resolve(envFile));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
  });
  const report = buildStandardBalanceSheetReport(data, TENANT, FY);
  console.log(getBalanceSheetMonthCheck(report, OCT));
}

main();
