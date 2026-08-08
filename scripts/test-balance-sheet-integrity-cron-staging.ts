/**
 * Run balance-sheet-integrity audit + system_event_log writes on staging.
 * Uses direct Supabase inserts (no server-only imports) so tsx can run it.
 *
 * Usage:
 *   npx tsx scripts/test-balance-sheet-integrity-cron-staging.ts --env-file .env.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentFinancialYear } from "../app/dashboard/finance/finance-year-utils";
import {
  auditTenantBalanceSheetIntegrity,
  type TenantBalanceSheetIntegrityResult,
} from "../utils/balance-sheet-integrity";
import { BS_INTEGRITY_EVENT_NAME } from "../utils/balance-sheet-integrity-constants";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

function buildTenantLogMessage(result: TenantBalanceSheetIntegrityResult): string {
  if (result.fetchError) {
    return `FY${result.fiscalYear}: fetch failed — ${result.fetchError}`;
  }
  if (result.imbalances.length === 0) {
    const through =
      result.monthsChecked.length > 0
        ? MONTH_LABELS[result.monthsChecked.at(-1)!]
        : "none";
    return `FY${result.fiscalYear}: balanced through ${through}`;
  }
  const monthSummary = result.imbalances
    .map((row) => `${row.monthLabel}=${row.diff.toFixed(2)}`)
    .join(", ");
  return `FY${result.fiscalYear}: out of balance — ${monthSummary}`;
}

async function logEvent(
  admin: SupabaseClient,
  input: {
    status: string;
    message: string;
    metadata: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("system_event_log").insert({
    event_type: "cron",
    event_name: BS_INTEGRITY_EVENT_NAME,
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });
  if (error) {
    console.error("[test-cron] log insert failed:", error.message);
  }
}

async function main() {
  let envFile = ".env.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;

  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const referenceDate = new Date();
  const fiscalYear = getCurrentFinancialYear();
  const runId = crypto.randomUUID();
  const referenceDateIso = referenceDate.toISOString().slice(0, 10);
  const startedAt = Date.now();

  console.log(`Running balance-sheet-integrity against ${url}`);

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (error) throw error;

  const tenantResults: TenantBalanceSheetIntegrityResult[] = [];
  for (const tenant of tenants ?? []) {
    const result = await auditTenantBalanceSheetIntegrity(
      admin,
      tenant,
      fiscalYear,
      referenceDate,
    );
    tenantResults.push(result);

    await logEvent(admin, {
      status: result.status,
      message: buildTenantLogMessage(result),
      metadata: {
        kind: "tenant",
        runId,
        referenceDate: referenceDateIso,
        tenantId: result.tenantId,
        tenantName: result.tenantName,
        fiscalYear: result.fiscalYear,
        monthsChecked: result.monthsChecked,
        imbalances: result.imbalances,
        maxAbsDiff: result.maxAbsDiff,
        durationMs: result.durationMs,
        fetchError: result.fetchError,
      },
    });
  }

  const balanced = tenantResults.filter((row) => row.status === "success").length;
  const warnings = tenantResults.filter((row) => row.status === "warning").length;
  const failures = tenantResults.filter((row) => row.status === "failure").length;

  await logEvent(admin, {
    status: failures > 0 ? "failure" : warnings > 0 ? "warning" : "success",
    message: `Checked ${tenantResults.length} tenant(s): ${balanced} balanced, ${warnings} warning(s), ${failures} failure(s)`,
    metadata: {
      kind: "run-summary",
      runId,
      referenceDate: referenceDateIso,
      fiscalYear,
      tenantsChecked: tenantResults.length,
      balanced,
      warnings,
      failures,
      durationMs: Date.now() - startedAt,
    },
  });

  console.log("\n--- Run summary ---");
  console.log({ runId, fiscalYear, balanced, warnings, failures });

  console.log("\n--- Per-tenant ---");
  for (const row of tenantResults) {
    console.log(
      `${row.tenantName.padEnd(28)} ${row.status.padEnd(8)} maxAbs=${row.maxAbsDiff.toFixed(2)} imbalances=${row.imbalances.length}`,
    );
  }

  const flagged = tenantResults.filter(
    (row) => row.status === "failure" || row.status === "warning",
  );
  if (flagged.length > 0) {
    console.log("\n--- Flagged (summary card should list these) ---");
    for (const row of flagged) {
      console.log(`${row.tenantName}: ${buildTenantLogMessage(row)}`);
    }
  } else {
    console.log("\nNo failures — summary card should show green 'all clear' state.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
