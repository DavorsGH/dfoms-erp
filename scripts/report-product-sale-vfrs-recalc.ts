/**
 * Read-only: Product Sales/POS VFRS rows with output_vat_amount > 0,
 * mapped to tax_ledger_entries and remittance status.
 *
 * Usage:
 *   npx tsx scripts/report-product-sale-vfrs-recalc.ts
 *   npx tsx scripts/report-product-sale-vfrs-recalc.ts --env-file .env.staging.local
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { REMITTED_STATUS } from "../app/dashboard/finance/tax-ledger-utils";

type IncomeRow = {
  id: string;
  tenant_id: string;
  date: string;
  invoice_no: string | null;
  amount: number;
  output_vat_amount: number;
  output_tax_component: string | null;
  sale_status: string | null;
};

type LedgerRow = {
  id: string;
  tenant_id: string;
  source_id: string;
  period_month: string;
  direction: string;
  tax_component: string;
  tax_amount: number;
  status: string;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string | null;
};

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

function parseArgs() {
  let envFile = ".env.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  return { envFile };
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function fetchAllIncome(admin: SupabaseClient) {
  const pageSize = 1000;
  const rows: IncomeRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("income_register")
      .select(
        "id, tenant_id, date, invoice_no, amount, output_vat_amount, output_tax_component, sale_status",
      )
      .eq("entry_type", "product_sale")
      .gt("output_vat_amount", 0)
      .order("tenant_id")
      .order("date")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = (data as IncomeRow[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchLedgerForIncomeIds(
  admin: SupabaseClient,
  incomeIds: string[],
) {
  const ledgerBySource = new Map<string, LedgerRow[]>();
  const chunkSize = 200;

  for (let i = 0; i < incomeIds.length; i += chunkSize) {
    const chunk = incomeIds.slice(i, i + chunkSize);
    const { data, error } = await admin
      .from("tax_ledger_entries")
      .select(
        "id, tenant_id, source_id, period_month, direction, tax_component, tax_amount, status",
      )
      .eq("source_type", "income_register")
      .eq("direction", "output")
      .eq("tax_component", "vfrs")
      .in("source_id", chunk);

    if (error) throw error;

    for (const row of (data as LedgerRow[] | null) ?? []) {
      const existing = ledgerBySource.get(row.source_id) ?? [];
      existing.push(row);
      ledgerBySource.set(row.source_id, existing);
    }
  }

  return ledgerBySource;
}

async function main() {
  const { envFile } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;

  const incomeRows = await fetchAllIncome(admin);
  const incomeIds = incomeRows.map((row) => row.id);
  const ledgerBySource = await fetchLedgerForIncomeIds(admin, incomeIds);

  const { data: tenantsData, error: tenantsError } = await admin
    .from("tenants")
    .select("id, name, slug");
  if (tenantsError) throw tenantsError;

  const tenantNameById = new Map<string, string>(
    ((tenantsData as TenantRow[] | null) ?? []).map((t) => [
      t.id,
      t.name || t.slug || t.id,
    ]),
  );

  type Bucket = {
    count: number;
    outputVatSum: number;
    periods: Set<string>;
  };

  type TenantSummary = {
    tenantId: string;
    tenantName: string;
    openUnremitted: Bucket;
    remitted: Bucket;
    other: Bucket & { byStatus: Record<string, number> };
    voidedWithTax: number;
    missingLedger: number;
    duplicateLedger: number;
  };

  const byTenant = new Map<string, TenantSummary>();

  function ensureTenant(tenantId: string): TenantSummary {
    let summary = byTenant.get(tenantId);
    if (!summary) {
      summary = {
        tenantId,
        tenantName: tenantNameById.get(tenantId) ?? tenantId,
        openUnremitted: { count: 0, outputVatSum: 0, periods: new Set() },
        remitted: { count: 0, outputVatSum: 0, periods: new Set() },
        other: { count: 0, outputVatSum: 0, periods: new Set(), byStatus: {} },
        voidedWithTax: 0,
        missingLedger: 0,
        duplicateLedger: 0,
      };
      byTenant.set(tenantId, summary);
    }
    return summary;
  }

  for (const income of incomeRows) {
    const summary = ensureTenant(income.tenant_id);
    const vat = r2(income.output_vat_amount);
    const legs = ledgerBySource.get(income.id) ?? [];

    if (income.sale_status === "voided") {
      summary.voidedWithTax += 1;
    }

    if (legs.length === 0) {
      summary.missingLedger += 1;
      summary.openUnremitted.count += 1;
      summary.openUnremitted.outputVatSum = r2(
        summary.openUnremitted.outputVatSum + vat,
      );
      continue;
    }

    if (legs.length > 1) {
      summary.duplicateLedger += 1;
    }

    const leg = legs[0]!;
    const period = leg.period_month?.slice(0, 7) ?? "unknown";

    if (leg.status === "open" || leg.status === "filed") {
      summary.openUnremitted.count += 1;
      summary.openUnremitted.outputVatSum = r2(
        summary.openUnremitted.outputVatSum + vat,
      );
      summary.openUnremitted.periods.add(period);
    } else if (leg.status === REMITTED_STATUS) {
      summary.remitted.count += 1;
      summary.remitted.outputVatSum = r2(summary.remitted.outputVatSum + vat);
      summary.remitted.periods.add(period);
    } else {
      summary.other.count += 1;
      summary.other.outputVatSum = r2(summary.other.outputVatSum + vat);
      summary.other.periods.add(period);
      summary.other.byStatus[leg.status] =
        (summary.other.byStatus[leg.status] ?? 0) + 1;
    }
  }

  const tenantSummaries = [...byTenant.values()].sort((a, b) =>
    a.tenantName.localeCompare(b.tenantName),
  );

  type RowDetail = {
    tenantName: string;
    incomeId: string;
    date: string;
    invoiceNo: string;
    amount: number;
    outputVat: number;
    saleStatus: string;
    periodMonth: string;
    ledgerStatus: string;
    bucket: "open_unremitted" | "remitted" | "other";
  };

  const rowDetails: RowDetail[] = [];

  for (const income of incomeRows) {
    const legs = ledgerBySource.get(income.id) ?? [];
    const leg = legs[0];
    const period = leg?.period_month?.slice(0, 7) ?? "—";
    const ledgerStatus = leg?.status ?? "missing";
    let bucket: RowDetail["bucket"] = "other";
    if (!leg || leg.status === "open" || leg.status === "filed") {
      bucket = "open_unremitted";
    } else if (leg.status === REMITTED_STATUS) {
      bucket = "remitted";
    }

    rowDetails.push({
      tenantName: tenantNameById.get(income.tenant_id) ?? income.tenant_id,
      incomeId: income.id,
      date: income.date,
      invoiceNo: income.invoice_no ?? "—",
      amount: r2(income.amount),
      outputVat: r2(income.output_vat_amount),
      saleStatus: income.sale_status ?? "active",
      periodMonth: period,
      ledgerStatus,
      bucket,
    });
  }

  const totals = tenantSummaries.reduce(
    (acc, row) => {
      acc.count += row.openUnremitted.count + row.remitted.count + row.other.count;
      acc.openCount += row.openUnremitted.count;
      acc.openVat += row.openUnremitted.outputVatSum;
      acc.remittedCount += row.remitted.count;
      acc.remittedVat += row.remitted.outputVatSum;
      acc.otherCount += row.other.count;
      acc.otherVat += row.other.outputVatSum;
      return acc;
    },
    {
      count: 0,
      openCount: 0,
      openVat: 0,
      remittedCount: 0,
      remittedVat: 0,
      otherCount: 0,
      otherVat: 0,
    },
  );

  const lines: string[] = [];
  lines.push("Product Sales/POS VFRS Recalculation Report (read-only)");
  lines.push(`Environment: ${url}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Scope: income_register where entry_type = 'product_sale' AND output_vat_amount > 0",
  );
  lines.push(
    "Ledger mapping: tax_ledger_entries source_type=income_register, direction=output, tax_component=vfrs",
  );
  lines.push(
    "Open/unremitted: ledger status open or filed, or no matching VFRS leg",
  );
  lines.push(`Remitted: ledger status = '${REMITTED_STATUS}' (UI: Paid / Remitted)`);
  lines.push("");
  lines.push(
    `Grand total: ${totals.count} rows, output VAT sum GHS ${r2(totals.openVat + totals.remittedVat + totals.otherVat)}`,
  );
  lines.push(
    `  (a) Open/unremitted: ${totals.openCount} rows, GHS ${r2(totals.openVat)}`,
  );
  lines.push(
    `  (b) Remitted: ${totals.remittedCount} rows, GHS ${r2(totals.remittedVat)}`,
  );
  if (totals.otherCount > 0) {
    lines.push(
      `  (other statuses): ${totals.otherCount} rows, GHS ${r2(totals.otherVat)}`,
    );
  }
  lines.push("");

  for (const row of tenantSummaries) {
    const totalCount =
      row.openUnremitted.count + row.remitted.count + row.other.count;
    const totalVat = r2(
      row.openUnremitted.outputVatSum +
        row.remitted.outputVatSum +
        row.other.outputVatSum,
    );

    lines.push(`--- ${row.tenantName} (${row.tenantId}) ---`);
    lines.push(`Total affected: ${totalCount} rows, GHS ${totalVat}`);
    lines.push(
      `  (a) Open/unremitted: ${row.openUnremitted.count} rows, GHS ${row.openUnremitted.outputVatSum}` +
        (row.openUnremitted.periods.size
          ? ` — periods: ${[...row.openUnremitted.periods].sort().join(", ")}`
          : ""),
    );
    lines.push(
      `  (b) Remitted: ${row.remitted.count} rows, GHS ${row.remitted.outputVatSum}` +
        (row.remitted.periods.size
          ? ` — periods: ${[...row.remitted.periods].sort().join(", ")}`
          : ""),
    );
    if (row.other.count > 0) {
      lines.push(
        `  Other: ${row.other.count} rows, GHS ${row.other.outputVatSum}` +
          ` — statuses: ${JSON.stringify(row.other.byStatus)}` +
          (row.other.periods.size
            ? ` — periods: ${[...row.other.periods].sort().join(", ")}`
            : ""),
      );
    }
    if (row.missingLedger > 0) {
      lines.push(`  Note: ${row.missingLedger} row(s) have output_vat_amount > 0 but no VFRS ledger leg`);
    }
    if (row.duplicateLedger > 0) {
      lines.push(`  Note: ${row.duplicateLedger} row(s) have multiple VFRS ledger legs`);
    }
    if (row.voidedWithTax > 0) {
      lines.push(`  Note: ${row.voidedWithTax} voided sale(s) still carry output_vat_amount > 0`);
    }
    lines.push("");
  }

  if (tenantSummaries.length === 0) {
    lines.push("No matching product sale rows found.");
  }

  if (rowDetails.length > 0) {
    lines.push("=== Row detail ===");
    for (const row of rowDetails) {
      lines.push(
        `${row.tenantName} | ${row.date} | ${row.invoiceNo} | amount GHS ${row.amount} | output VAT GHS ${row.outputVat} | period ${row.periodMonth} | ledger ${row.ledgerStatus} | ${row.bucket} | sale ${row.saleStatus}`,
      );
    }
  }

  const report = lines.join("\n");
  console.log(report);
  writeFileSync("product-sale-vfrs-recalc-report.txt", report, "utf8");
  console.log("\nWrote product-sale-vfrs-recalc-report.txt");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
