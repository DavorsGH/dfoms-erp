/**
 * Production data fix: single source of cash for Director's Loan (ledger + patched manuals).
 *
 *   npx tsx scripts/fix-directors-loan-ledger-manual-cash-production.ts --dry-run
 *   npx tsx scripts/fix-directors-loan-ledger-manual-cash-production.ts --env-file .env.local.backup --allow-production --apply
 *   npx tsx scripts/fix-directors-loan-ledger-manual-cash-production.ts --env-file .env.local.backup --allow-production --backfill-migration-log
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import { getBalanceCheckForPeriod } from "../app/dashboard/finance/balance-sheet-utils";
import type { ManualFinancialEntryRecord } from "../app/dashboard/finance/manual-financial-entries-utils";
import {
  DIRECTORS_LOAN_LEDGER_SELECT,
  patchManualFinancialEntriesForDirectorLoanLedger,
  type DirectorsLoanLedgerEntry,
} from "../app/dashboard/finance/directors-loan-ledger-utils";
import {
  buildReportBundle,
  compareSnapshots,
  normalizeMigratedLedgerReference,
  snapshotNewPath,
  PARITY_FY,
  TOLERANCE,
} from "./lib/directors-loan-migration-parity";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const LOGISTICS_BU = "2ae591d2-0f89-44d0-83af-1133cfe7a32c";

const argv = process.argv.slice(2);
const args = new Set(argv);

function getArgValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

function loadEnv(file: string) {
  for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function snapCashAndDue(bundle: ReturnType<typeof buildReportBundle>, mi: number) {
  const row = (key: string) =>
    bundle.balanceSheet.rows.find((r) => r.key === key)?.amounts[mi] ?? 0;
  return {
    cash: row("cash"),
    dueFrom: row("due-from-director"),
    assets: row("total-assets"),
    le: row("total-liabilities-and-equity"),
    diff: getBalanceCheckForPeriod(bundle.balanceSheet, mi).difference,
  };
}

async function snapshotTenant(
  admin: SupabaseClient,
  tenantId: string,
  scopes: Array<{ key: string; fetch: Parameters<typeof fetchBalanceSheetPageData>[2] }>,
  options?: {
    ledgerOverride?: DirectorsLoanLedgerEntry[];
    manualOverride?: ManualFinancialEntryRecord[];
  },
) {
  const out = new Map<string, Record<string, number[]>>();
  for (const scope of scopes) {
    const data = await fetchBalanceSheetPageData(admin, tenantId, scope.fetch);
    const ledger = (
      options?.ledgerOverride ??
      (data.initialDirectorsLoanLedgerEntries ?? [])
    ).filter((e) => !e.reversed_at);
    const buMode = scope.fetch.viewAllBusinessUnits
      ? "all"
      : scope.fetch.activeBusinessUnitId
        ? "unit"
        : "default";
    let manualOverride = options?.manualOverride;
    if (manualOverride && !scope.fetch.viewAllBusinessUnits && scope.fetch.activeBusinessUnitId) {
      manualOverride = manualOverride.filter(
        (m) => m.business_unit_id === scope.fetch.activeBusinessUnitId,
      );
    } else if (manualOverride && !scope.fetch.viewAllBusinessUnits && !scope.fetch.activeBusinessUnitId) {
      manualOverride = manualOverride.filter((m) => m.business_unit_id == null);
    }
    const bundle = buildReportBundle(
      data,
      buMode,
      PARITY_FY,
      ledger,
      manualOverride,
      scope.fetch.activeBusinessUnitId,
    );
    out.set(scope.key, snapshotNewPath(bundle));
  }
  return out;
}

async function scopesForTenant(admin: SupabaseClient, tenantId: string) {
  const { data: units } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const logistics = units?.find((u) => u.id === LOGISTICS_BU);
  const facilities = units?.find((u) =>
    /facilities/i.test(String(u.name ?? "")),
  );
  const scopes: Array<{ key: string; fetch: Parameters<typeof fetchBalanceSheetPageData>[2] }> = [
    {
      key: "all",
      fetch: { viewAllBusinessUnits: true, activeBusinessUnitId: null },
    },
  ];
  if (logistics) {
    scopes.push({
      key: "logistics",
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: LOGISTICS_BU },
    });
  }
  if (facilities) {
    scopes.push({
      key: "facilities",
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: facilities.id as string,
      },
    });
  }
  return scopes;
}

type RefFix = { id: string; oldRef: string | null; newRef: string | null };
type ManualFix = {
  tenant_id: string;
  period_month: string;
  business_unit_id: string | null;
  loan_proceeds: number;
  loan_repayments: number;
  prev_loan_proceeds: number;
  prev_loan_repayments: number;
};

async function planFixes(admin: SupabaseClient, tenantId: string) {
  const { data: ledgerRows } = await admin
    .from("directors_loan_entries")
    .select(DIRECTORS_LOAN_LEDGER_SELECT)
    .eq("tenant_id", tenantId);

  const ledger = (ledgerRows ?? []) as DirectorsLoanLedgerEntry[];
  const refFixes: RefFix[] = [];
  const ledgerAfterRefs = ledger.map((e) => {
    const newRef = normalizeMigratedLedgerReference(e.reference);
    if (newRef !== e.reference) {
      refFixes.push({ id: e.id, oldRef: e.reference, newRef });
    }
    return newRef === e.reference ? e : { ...e, reference: newRef };
  });

  const { data: manuals } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", tenantId);

  const patched = patchManualFinancialEntriesForDirectorLoanLedger(
    (manuals ?? []) as ManualFinancialEntryRecord[],
    ledgerAfterRefs,
    PARITY_FY,
  );

  const manualFixes: ManualFix[] = [];
  for (let i = 0; i < (manuals ?? []).length; i += 1) {
    const before = manuals![i] as ManualFinancialEntryRecord;
    const after = patched[i] as ManualFinancialEntryRecord;
    const y = Number(String(before.period_month).slice(0, 4));
    if (y !== PARITY_FY) continue;
    const lp0 = Number(before.loan_proceeds) || 0;
    const lp1 = Number(after.loan_proceeds) || 0;
    const lr0 = Number(before.loan_repayments) || 0;
    const lr1 = Number(after.loan_repayments) || 0;
    if (lp0 === lp1 && lr0 === lr1 && (Number(before.directors_loan) || 0) === 0) continue;
    manualFixes.push({
      tenant_id: tenantId,
      period_month: String(before.period_month),
      business_unit_id: before.business_unit_id ?? null,
      loan_proceeds: lp1,
      loan_repayments: lr1,
      prev_loan_proceeds: lp0,
      prev_loan_repayments: lr0,
    });
  }

  return { refFixes, manualFixes, ledgerAfterRefs, patchedManuals: patched };
}

async function applyInTransaction(
  dbUrl: string,
  refFixes: RefFix[],
  manualFixes: ManualFix[],
) {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const fix of refFixes) {
      await client.query(`UPDATE directors_loan_entries SET reference = $2 WHERE id = $1`, [
        fix.id,
        fix.newRef,
      ]);
    }
    for (const fix of manualFixes) {
      if (fix.business_unit_id == null) {
        await client.query(
          `UPDATE manual_financial_entries
           SET directors_loan = 0, loan_proceeds = $3, loan_repayments = $4
           WHERE tenant_id = $1 AND period_month = $2 AND business_unit_id IS NULL`,
          [fix.tenant_id, fix.period_month, fix.loan_proceeds, fix.loan_repayments],
        );
      } else {
        await client.query(
          `UPDATE manual_financial_entries
           SET directors_loan = 0, loan_proceeds = $4, loan_repayments = $5
           WHERE tenant_id = $1 AND period_month = $2 AND business_unit_id = $3`,
          [
            fix.tenant_id,
            fix.period_month,
            fix.business_unit_id,
            fix.loan_proceeds,
            fix.loan_repayments,
          ],
        );
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

async function logEvent(
  admin: SupabaseClient,
  eventName: string,
  message: string,
  metadata: Record<string, unknown>,
) {
  const { error } = await admin.from("system_event_log").insert({
    event_type: "cron",
    event_name: eventName,
    status: "success",
    message,
    metadata,
  });
  if (error) throw new Error(`system_event_log: ${error.message}`);
}

async function backfillMigrationLog(admin: SupabaseClient, tenantId: string) {
  const { data: rows } = await admin
    .from("directors_loan_entries")
    .select("id, tenant_id, business_unit_id, entry_date, entry_type, amount, reference, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at");

  const migrated = (rows ?? []).filter((r) =>
    String(r.reference ?? "").toLowerCase().includes("migrated"),
  );
  if (migrated.length === 0) {
    console.log("No migrated ledger rows to backfill.");
    return;
  }

  const { data: existing } = await admin
    .from("system_event_log")
    .select("id")
    .eq("event_name", "directors_loan_ledger_migration")
    .limit(1);

  if ((existing ?? []).length > 0) {
    console.log("directors_loan_ledger_migration event already exists — skip backfill.");
    return;
  }

  if (!args.has("--apply") && !args.has("--backfill-migration-log")) {
    console.log(`Would backfill system_event_log for ${migrated.length} migrated row(s).`);
    return;
  }

  await logEvent(
    admin,
    "directors_loan_ledger_migration",
    `Director's Loan ledger migration (production): ${migrated.length} row(s) created (backfilled).`,
    {
      environment: "production",
      row_count: migrated.length,
      backfilled: true,
      rows: migrated,
    },
  );
  console.log("Backfilled directors_loan_ledger_migration system_event_log.");
}

async function main() {
  const apply = args.has("--apply");
  const dryRun = !apply;
  const envFile = getArgValue("--env-file") ?? ".env.local.backup";
  loadEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";

  if (apply && !args.has("--allow-production")) {
    throw new Error("--apply requires --allow-production");
  }
  if (apply && envFile !== ".env.local.backup") {
    throw new Error("--apply requires --env-file .env.local.backup");
  }
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: not production Supabase URL");
  }
  if (apply && !dbUrl.includes(PRODUCTION_REF)) {
    throw new Error("DATABASE_URL must match production for --apply");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: tenants } = await admin.from("tenants").select("id, name");

  if (args.has("--backfill-migration-log") && !apply) {
    for (const t of tenants ?? []) {
      await backfillMigrationLog(admin, t.id as string);
    }
    return;
  }

  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const tenantName = String(tenant.name);
    const scopes = await scopesForTenant(admin, tenantId);
    const beforeSnaps = await snapshotTenant(admin, tenantId, scopes);

    const { refFixes, manualFixes, ledgerAfterRefs, patchedManuals } =
      await planFixes(admin, tenantId);

    console.log(`\n=== ${tenantName} (${tenantId}) — ${dryRun ? "DRY RUN" : "APPLY"} ===`);
    console.log(`Reference fixes: ${refFixes.length}`);
    for (const f of refFixes) {
      console.log(`  ${f.id}: ${JSON.stringify(f.oldRef)} → ${JSON.stringify(f.newRef)}`);
    }
    console.log(`Manual row fixes (FY${PARITY_FY}): ${manualFixes.length}`);
    for (const f of manualFixes) {
      console.log(
        `  ${f.period_month} BU=${f.business_unit_id ?? "null"} loan_proceeds ${f.prev_loan_proceeds}→${f.loan_proceeds} loan_repayments ${f.prev_loan_repayments}→${f.loan_repayments}`,
      );
    }

    if (apply && (refFixes.length > 0 || manualFixes.length > 0)) {
      await applyInTransaction(dbUrl, refFixes, manualFixes);
      await logEvent(
        admin,
        "directors_loan_ledger_manual_cash_fix",
        `Director's Loan manual cash alignment (production): ${refFixes.length} ref(s), ${manualFixes.length} manual row(s).`,
        {
          environment: "production",
          tenant_id: tenantId,
          ref_fixes: refFixes,
          manual_fixes: manualFixes,
        },
      );
    }

    const afterSnaps = dryRun
      ? await snapshotTenant(admin, tenantId, scopes, {
          ledgerOverride: ledgerAfterRefs,
          manualOverride: patchedManuals as ManualFinancialEntryRecord[],
        })
      : await snapshotTenant(admin, tenantId, scopes);

    console.log(dryRun ? "\n--- Current (production) Sep–Dec ---" : "\n--- After apply Sep–Dec ---");
    for (const scope of scopes) {
      const snap = beforeSnaps.get(scope.key)!;
      const cashKey = "BS:cash";
      const dueKey = "BS:due-from-director";
      for (const mi of [8, 9, 10, 11]) {
        const beforeCash = snap[cashKey]?.[mi] ?? 0;
        const beforeDue = snap[dueKey]?.[mi] ?? 0;
        const afterSnap = afterSnaps.get(scope.key)!;
        const afterCash = afterSnap[cashKey]?.[mi] ?? 0;
        const afterDue = afterSnap[dueKey]?.[mi] ?? 0;
        console.log(
          `  ${scope.key} M${mi + 1}: cash ${beforeCash} → ${afterCash} (Δ${Math.round((afterCash - beforeCash) * 100) / 100}) | due-from ${beforeDue} → ${afterDue}`,
        );
      }
    }

    if (dryRun) {
      console.log("\n--- Simulated post-fix balance check (Logistics) ---");
      const logisticsScope = scopes.find((s) => s.key === "logistics");
      if (logisticsScope) {
        const data = await fetchBalanceSheetPageData(admin, tenantId, logisticsScope.fetch);
        const bundle = buildReportBundle(
          data,
          "unit",
          PARITY_FY,
          ledgerAfterRefs.filter((e) => !e.reversed_at),
          (patchedManuals as ManualFinancialEntryRecord[]).filter(
            (m) => m.business_unit_id === LOGISTICS_BU,
          ),
          LOGISTICS_BU,
        );
        for (const mi of [8, 9, 10, 11]) {
          const s = snapCashAndDue(bundle, mi);
          console.log(
            `  logistics M${mi + 1}: cash=${s.cash} due-from=${s.dueFrom} imbalance=${s.diff}`,
          );
          if (Math.abs(s.diff) > TOLERANCE) {
            throw new Error(`Dry-run simulated Logistics M${mi + 1} still imbalanced`);
          }
        }
      }
    }

    if (!dryRun) {
      for (const scope of scopes) {
        const before = beforeSnaps.get(scope.key)!;
        const after = afterSnaps.get(scope.key)!;
        const diffs = compareSnapshots(before, after);
        const unexpected = diffs.filter((d) => {
          if (scope.key === "facilities") return Math.abs(d.delta) > TOLERANCE;
          if (scope.key === "logistics") {
            const allowed =
              (d.key === "BS:cash" && d.delta <= 0) ||
              (d.key === "BS:due-from-director" && d.delta >= 0) ||
              d.key === "BS:total-assets" ||
              d.key === "BS:total-liabilities-and-equity";
            return !allowed && Math.abs(d.delta) > TOLERANCE;
          }
          return Math.abs(d.delta) > TOLERANCE;
        });
        if (unexpected.length > 0) {
          console.error(`Unexpected snapshot deltas for ${scope.key}:`);
          for (const d of unexpected.slice(0, 20)) {
            console.error(`  ${d.key} M${d.month} Δ=${d.delta}`);
          }
          process.exit(1);
        }
      }
    }

    await backfillMigrationLog(admin, tenantId);
  }

  console.log(dryRun ? "\nDRY RUN complete." : "\nAPPLY complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
