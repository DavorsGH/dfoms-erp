/**
 * Production read-only: auto-posted register rows whose category/sub-category
 * drifted from system posting conventions.
 *
 * npx tsx scripts/audits/readonly-production-auto-posted-category-drift.ts --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
  STATUTORY_REMITTANCE_SUB_CATEGORY,
} from "../../app/dashboard/finance/tax-ledger-remit";
import {
  PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
  PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL,
} from "../../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  STAFF_WELFARE_CONTRIBUTION_CATEGORY,
  STAFF_WELFARE_DISBURSEMENT_CATEGORY,
} from "../../app/dashboard/finance/staff-welfare-fund-utils";
import { normalizeCategoryName } from "../../app/dashboard/finance/profit-loss-utils";

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

function norm(v: string | null | undefined) {
  return normalizeCategoryName(v ?? "");
}

type DriftRow = {
  register: "expense" | "income";
  tenant_id: string;
  tenant_name: string;
  id: string;
  date: string;
  amount: number;
  receipt_or_invoice: string;
  expense_category?: string;
  sub_category?: string;
  service_category?: string;
  expected: string;
  signal: string;
};

function checkExpense(row: Record<string, unknown>, tenantName: string): DriftRow | null {
  const receipt = String(row.receipt_no ?? "").trim();
  const ru = receipt.toUpperCase();
  const cat = String(row.expense_category ?? "");
  const sub = String(row.sub_category ?? "");
  const amount = Number(row.amount) || 0;

  const push = (signal: string, expectedCat: string, expectedSub: string | null) => {
    const catOk = norm(cat) === norm(expectedCat);
    const subOk =
      expectedSub == null || norm(sub) === norm(expectedSub);
    if (catOk && subOk) return null;
    return {
      register: "expense" as const,
      tenant_id: String(row.tenant_id),
      tenant_name: tenantName,
      id: String(row.id),
      date: String(row.date).slice(0, 10),
      amount,
      receipt_or_invoice: receipt,
      expense_category: cat,
      sub_category: sub,
      expected: expectedSub
        ? `${expectedCat} / ${expectedSub}`
        : expectedCat,
      signal,
    };
  };

  if (/^TAX-REMIT-/i.test(receipt)) {
    return push(
      "TAX-REMIT",
      STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
      STATUTORY_REMITTANCE_SUB_CATEGORY,
    );
  }
  if (/^PAYROLL-SAL-/i.test(receipt)) {
    return push(
      "PAYROLL-SAL",
      PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
      PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL,
    );
  }
  if (/^PAYROLL-ESSNIT-/i.test(receipt)) {
    return push(
      "PAYROLL-ESSNIT",
      PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
      PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL,
    );
  }
  if (/^(VOID-)?COGS-/i.test(receipt) || /^RET-COGS-/i.test(receipt)) {
    return push("COGS/VOID/RET-COGS", "Cost of Goods Sold", null);
  }
  if (/^STKADJ-/i.test(receipt)) {
    return push("STKADJ", "Direct Operational", "Inventory loss");
  }
  if (/^IC-/i.test(receipt)) {
    return push("IC", "Direct Operational", "Finished Goods - Internal Use");
  }
  if (/^PSK-FEE-/i.test(receipt)) {
    return push("PSK-FEE", "Direct Operational", "Paystack Transaction Fees");
  }
  if (ru.startsWith("WELFARE-DISB-")) {
    return push("WELFARE-DISB", STAFF_WELFARE_DISBURSEMENT_CATEGORY, "Staff Welfare");
  }
  if (ru.startsWith("WELFARE-CONT-")) {
    return push("WELFARE-CONT", STAFF_WELFARE_CONTRIBUTION_CATEGORY, "Staff Welfare");
  }
  if (row.is_customer_refund === true || /^REFUND-/i.test(receipt)) {
    return push("REFUND", "Other", null);
  }
  return null;
}

function checkIncome(row: Record<string, unknown>, tenantName: string): DriftRow | null {
  const invoice = String(row.invoice_no ?? "").trim();
  const iu = invoice.toUpperCase();
  const cat = String(row.service_category ?? "");
  const amount = Number(row.amount) || 0;
  const description = String(row.description ?? "").trim();

  const push = (signal: string, expectedCat: string) => {
    if (norm(cat) === norm(expectedCat)) return null;
    return {
      register: "income" as const,
      tenant_id: String(row.tenant_id),
      tenant_name: tenantName,
      id: String(row.id),
      date: String(row.date).slice(0, 10),
      amount,
      receipt_or_invoice: invoice,
      service_category: cat,
      expected: expectedCat,
      signal,
    };
  };

  if (row.is_system_adjustment === true) {
    return null;
  }
  if (/^PAYROLL-DEDSAV-/i.test(invoice)) {
    return push("PAYROLL-DEDSAV", "Other Income");
  }
  if (iu.startsWith("PSK-INC-")) {
    return push("PSK-INC", "Platform Billing");
  }
  if (description === "Inventory gain (stock adjustment)") {
    return push("inventory-gain", "Other Income");
  }
  if ((row.entry_type ?? "") === "product_sale") {
    return null;
  }
  return null;
}

async function main() {
  let envFile = ".env.local.backup";
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  loadEnv(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) {
    throw new Error(`Refusing: expected production ref ${PROD_REF}`);
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: tenants } = await admin.from("tenants").select("id, name");
  const tenantNameById = new Map(
    (tenants ?? []).map((t) => [t.id as string, t.name as string]),
  );

  const drifts: DriftRow[] = [];

  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const tenantName = (tenant.name as string) ?? tenantId;

    const { data: expenses } = await admin
      .from("expense_register")
      .select(
        "id, tenant_id, date, amount, receipt_no, expense_category, sub_category, is_customer_refund",
      )
      .eq("tenant_id", tenantId);

    for (const row of expenses ?? []) {
      const drift = checkExpense(row as Record<string, unknown>, tenantName);
      if (drift) drifts.push(drift);
    }

    const { data: incomes } = await admin
      .from("income_register")
      .select(
        "id, tenant_id, date, amount, invoice_no, service_category, description, entry_type, is_system_adjustment",
      )
      .eq("tenant_id", tenantId);

    for (const row of incomes ?? []) {
      const drift = checkIncome(row as Record<string, unknown>, tenantName);
      if (drift) drifts.push(drift);
    }
  }

  console.log("miscategorized_auto_posted_count", drifts.length);
  if (drifts.length) {
    console.table(drifts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
