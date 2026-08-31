/**
 * READ-ONLY: Inventory accounts_payable rows per tenant for AP accrual backfill.
 *
 * Classifies each AP with the same helpers as the live auto-post path:
 *   shouldPostAccountsPayableAccrualExpense /
 *   isFixedAssetCreditPayable /
 *   isStatutoryRemittancePayable
 *
 * Usage:
 *   npx tsx scripts/_ap-accrual-backfill-inventory-readonly.ts
 *   npx tsx scripts/_ap-accrual-backfill-inventory-readonly.ts --env-file .env.local.backup
 *
 * Default env: .env.staging.local. No writes under any env.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";
import {
  buildAccountsPayableAccrualReceiptNo,
  isFixedAssetCreditPayable,
  shouldPostAccountsPayableAccrualExpense,
} from "../app/dashboard/finance/accounts-payable-accrual-utils";
import { isStatutoryRemittancePayable } from "../app/dashboard/finance/balance-sheet-ap-cash-utils";

const envFile = loadEnvFromArgv(process.argv);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Same net_of_tax resolution as buildAccrualPayload in accounts-payable-accrual-utils. */
function resolveNetOfTaxAmount(row: {
  amount: number | null;
  net_of_tax_amount?: number | null;
}): number {
  const amount = round2(Number(row.amount) || 0);
  if (row.net_of_tax_amount != null) {
    return round2(Number(row.net_of_tax_amount) || 0);
  }
  return amount;
}

function getBalanceDue(row: {
  amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
}): number {
  if (row.balance_due != null) {
    return Math.max(Number(row.balance_due) || 0, 0);
  }
  return Math.max(
    (Number(row.amount) || 0) - (Number(row.amount_paid) || 0),
    0,
  );
}

type TenantRow = { id: string; name: string | null };
type ApRow = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  expense_category: string | null;
  amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  net_of_tax_amount: number | null;
  source_type: string | null;
};

type TenantReport = {
  tenantId: string;
  tenantName: string;
  totalAp: number;
  alreadyHasAccrual: number;
  fixedAssetExcluded: number;
  statutoryExcluded: number;
  operatingNeedingBackfill: number;
  operatingUnpaidNeeding: number;
  operatingPaidNeeding: number;
  backfillNetOfTaxSum: number;
  operatingAlreadyHasAccrual: number;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const isStaging = url.includes("wieflwbfdmjtsdnwbfii");
  const isProductionBackupEnv =
    envFile.replace(/\\/g, "/").endsWith(".env.local.backup");
  if (!isStaging && !isProductionBackupEnv) {
    throw new Error(
      `Refusing URL unless staging or --env-file .env.local.backup (got env=${envFile}, url=${url})`,
    );
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const targetLabel = isStaging ? "staging" : "PRODUCTION";
  console.log(`READ-ONLY AP accrual backfill inventory (${targetLabel})`);
  console.log(`env-file: ${envFile}`);
  console.log(`URL: ${url}`);
  console.log("No writes.\n");

  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (tenantError) throw new Error(`tenants: ${tenantError.message}`);

  const reports: TenantReport[] = [];

  for (const tenant of (tenants as TenantRow[] | null) ?? []) {
    const tenantId = tenant.id;
    const tenantName = (tenant.name ?? "").trim() || tenantId;

    const { data: payables, error: apError } = await admin
      .from("accounts_payable")
      .select(
        "id, vendor_name, invoice_number, expense_category, amount, amount_paid, balance_due, net_of_tax_amount, source_type",
      )
      .eq("tenant_id", tenantId);
    if (apError) throw new Error(`${tenantName} AP: ${apError.message}`);

    const apRows = (payables as ApRow[] | null) ?? [];

    const { data: accrualExpenses, error: expError } = await admin
      .from("expense_register")
      .select("receipt_no")
      .eq("tenant_id", tenantId)
      .like("receipt_no", "AP-ACCRUAL-%");
    if (expError) {
      throw new Error(`${tenantName} expense_register: ${expError.message}`);
    }

    const accrualReceipts = new Set(
      ((accrualExpenses as Array<{ receipt_no: string | null }> | null) ?? [])
        .map((row) => row.receipt_no)
        .filter((value): value is string => Boolean(value)),
    );

    let alreadyHasAccrual = 0;
    let fixedAssetExcluded = 0;
    let statutoryExcluded = 0;
    let operatingNeedingBackfill = 0;
    let operatingUnpaidNeeding = 0;
    let operatingPaidNeeding = 0;
    let backfillNetOfTaxSum = 0;
    let operatingAlreadyHasAccrual = 0;

    for (const row of apRows) {
      const receiptNo = buildAccountsPayableAccrualReceiptNo(row.id);
      const hasAccrual = accrualReceipts.has(receiptNo);
      if (hasAccrual) alreadyHasAccrual += 1;

      const classifyInput = {
        source_type: row.source_type,
        vendor_name: row.vendor_name,
        invoice_number: row.invoice_number,
        expense_category: row.expense_category,
      };

      if (isFixedAssetCreditPayable(classifyInput)) {
        fixedAssetExcluded += 1;
        continue;
      }
      if (isStatutoryRemittancePayable(classifyInput)) {
        statutoryExcluded += 1;
        continue;
      }
      if (!shouldPostAccountsPayableAccrualExpense(classifyInput)) {
        // Defensive: helpers above should cover all skip reasons.
        statutoryExcluded += 1;
        continue;
      }

      // Operating AP
      if (hasAccrual) {
        operatingAlreadyHasAccrual += 1;
        continue;
      }

      operatingNeedingBackfill += 1;
      const balanceDue = getBalanceDue(row);
      if (balanceDue > 0) {
        operatingUnpaidNeeding += 1;
      } else {
        operatingPaidNeeding += 1;
      }
      backfillNetOfTaxSum = round2(
        backfillNetOfTaxSum + resolveNetOfTaxAmount(row),
      );
    }

    const report: TenantReport = {
      tenantId,
      tenantName,
      totalAp: apRows.length,
      alreadyHasAccrual,
      fixedAssetExcluded,
      statutoryExcluded,
      operatingNeedingBackfill,
      operatingUnpaidNeeding,
      operatingPaidNeeding,
      backfillNetOfTaxSum,
      operatingAlreadyHasAccrual,
    };
    reports.push(report);

    console.log(`=== ${tenantName} (${tenantId}) ===`);
    console.log(`  1. Total accounts_payable:              ${report.totalAp}`);
    console.log(
      `  2. Already has AP-ACCRUAL-{id}:          ${report.alreadyHasAccrual}` +
        (report.operatingAlreadyHasAccrual
          ? ` (of which operating: ${report.operatingAlreadyHasAccrual})`
          : ""),
    );
    console.log(
      `  3. Fixed Asset credit (excluded):       ${report.fixedAssetExcluded}`,
    );
    console.log(
      `  4. Statutory remittance (excluded):     ${report.statutoryExcluded}`,
    );
    console.log(
      `  5. Operating needing backfill:          ${report.operatingNeedingBackfill}`,
    );
    console.log(
      `       unpaid (balance_due > 0):          ${report.operatingUnpaidNeeding}`,
    );
    console.log(
      `       paid   (balance_due = 0):          ${report.operatingPaidNeeding}`,
    );
    console.log(
      `  6. Backfill net_of_tax sum (operating): GHS ${report.backfillNetOfTaxSum.toFixed(2)}`,
    );
    console.log("");
  }

  const grand = reports.reduce(
    (acc, row) => ({
      totalAp: acc.totalAp + row.totalAp,
      alreadyHasAccrual: acc.alreadyHasAccrual + row.alreadyHasAccrual,
      fixedAssetExcluded: acc.fixedAssetExcluded + row.fixedAssetExcluded,
      statutoryExcluded: acc.statutoryExcluded + row.statutoryExcluded,
      operatingNeedingBackfill:
        acc.operatingNeedingBackfill + row.operatingNeedingBackfill,
      operatingUnpaidNeeding:
        acc.operatingUnpaidNeeding + row.operatingUnpaidNeeding,
      operatingPaidNeeding: acc.operatingPaidNeeding + row.operatingPaidNeeding,
      backfillNetOfTaxSum: round2(
        acc.backfillNetOfTaxSum + row.backfillNetOfTaxSum,
      ),
      operatingAlreadyHasAccrual:
        acc.operatingAlreadyHasAccrual + row.operatingAlreadyHasAccrual,
    }),
    {
      totalAp: 0,
      alreadyHasAccrual: 0,
      fixedAssetExcluded: 0,
      statutoryExcluded: 0,
      operatingNeedingBackfill: 0,
      operatingUnpaidNeeding: 0,
      operatingPaidNeeding: 0,
      backfillNetOfTaxSum: 0,
      operatingAlreadyHasAccrual: 0,
    },
  );

  console.log("=== GRAND TOTAL (all tenants) ===");
  console.log(`  Tenants scanned:                        ${reports.length}`);
  console.log(`  1. Total accounts_payable:              ${grand.totalAp}`);
  console.log(
    `  2. Already has AP-ACCRUAL-{id}:          ${grand.alreadyHasAccrual}` +
      (grand.operatingAlreadyHasAccrual
        ? ` (of which operating: ${grand.operatingAlreadyHasAccrual})`
        : ""),
  );
  console.log(
    `  3. Fixed Asset credit (excluded):       ${grand.fixedAssetExcluded}`,
  );
  console.log(
    `  4. Statutory remittance (excluded):     ${grand.statutoryExcluded}`,
  );
  console.log(
    `  5. Operating needing backfill:          ${grand.operatingNeedingBackfill}`,
  );
  console.log(
    `       unpaid (balance_due > 0):          ${grand.operatingUnpaidNeeding}`,
  );
  console.log(
    `       paid   (balance_due = 0):          ${grand.operatingPaidNeeding}`,
  );
  console.log(
    `  6. Backfill net_of_tax sum (operating): GHS ${grand.backfillNetOfTaxSum.toFixed(2)}`,
  );
  console.log("\nDone (read-only).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
