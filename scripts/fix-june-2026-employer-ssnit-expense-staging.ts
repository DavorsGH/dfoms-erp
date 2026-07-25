/**
 * Staging-only: correct Employer SSNIT expense_register amount for June 2026.
 *
 * Target: 445.31 (= employer Tier 1 274.03 + Tier 2 171.28).
 * Does NOT touch production. Does NOT modify tax_ledger_entries.
 *
 * Usage: npx tsx scripts/fix-june-2026-employer-ssnit-expense-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const TARGET_AMOUNT = 445.31;
const EXPECTED_DATE = "2026-06-29";
const CATEGORY = "Employer SSNIT Contribution";
const APPROX_CURRENT = 676.07;
const PERIOD_MONTH = "2026-06-01";

const SELECT_COLS = [
  "id",
  "tenant_id",
  "date",
  "expense_category",
  "sub_category",
  "description",
  "vendor",
  "price",
  "quantity",
  "amount",
  "payment_method",
  "payment_status",
  "receipt_no",
  "approved_by",
  "notes",
  "input_vat_amount",
  "wht_amount",
  "net_of_tax_amount",
  "gross_before_wht",
].join(", ");

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

function num(v: unknown): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function snapshot(row: Record<string, unknown>) {
  return {
    id: row.id,
    date: row.date,
    expense_category: row.expense_category,
    sub_category: row.sub_category,
    description: row.description,
    vendor: row.vendor,
    price: num(row.price),
    quantity: num(row.quantity),
    amount: num(row.amount),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    receipt_no: row.receipt_no,
    approved_by: row.approved_by,
    notes: row.notes,
    input_vat_amount: row.input_vat_amount,
    wht_amount: row.wht_amount,
    net_of_tax_amount: row.net_of_tax_amount,
    gross_before_wht: row.gross_before_wht,
  };
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(
    url.includes(STAGING_PROJECT_REF),
    `Refusing non-staging URL (expected ref ${STAGING_PROJECT_REF})`,
  );
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(
    !url.includes("supabase.co") || url.includes(STAGING_PROJECT_REF),
    "URL safety check failed",
  );

  console.log("=== Staging assert ===");
  console.log(`project_ref: ${STAGING_PROJECT_REF} (matched in URL)`);
  console.log(`tenant_id: ${DAVORS_TENANT_ID}`);
  console.log("production: NOT touched");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prefer auto-posted receipt; fall back to category/date/amount match.
  const essnitReceipt = "PAYROLL-ESSNIT-2026-06";

  const { data: byReceipt, error: receiptErr } = await admin
    .from("expense_register")
    .select(SELECT_COLS)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("receipt_no", essnitReceipt)
    .maybeSingle();

  if (receiptErr) throw new Error(`receipt lookup: ${receiptErr.message}`);

  let row = (byReceipt as unknown as Record<string, unknown> | null) ?? null;
  let matchMode = row ? "receipt_no" : null;

  if (!row) {
    const { data: candidates, error: candErr } = await admin
      .from("expense_register")
      .select(SELECT_COLS)
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("date", EXPECTED_DATE)
      .or(
        `expense_category.eq.${CATEGORY},expense_category.ilike.%Employer%SSNIT%,description.ilike.%Employer%SSNIT%`,
      );

    if (candErr) throw new Error(`candidate scan: ${candErr.message}`);

    const list = (candidates ?? []) as unknown as Record<string, unknown>[];
    console.log(`\nCandidates on ${EXPECTED_DATE}: ${list.length}`);
    for (const c of list) {
      console.log(
        `  id=${c.id} amount=${num(c.amount)} cat=${c.expense_category} receipt=${c.receipt_no ?? "(blank)"}`,
      );
    }

    const near = list.filter(
      (c) => Math.abs(num(c.amount) - APPROX_CURRENT) < 1,
    );
    const exactCat = list.filter((c) => c.expense_category === CATEGORY);
    row =
      (near.length === 1 ? near[0] : null) ??
      (exactCat.length === 1 ? exactCat[0] : null) ??
      (list.length === 1 ? list[0] : null);
    matchMode = near.length === 1
      ? "date+amount~676.07"
      : exactCat.length === 1
        ? "date+category"
        : list.length === 1
          ? "single candidate"
          : null;
  }

  assert(row, "Could not uniquely identify Employer SSNIT expense row");
  assert(matchMode, "Ambiguous match");

  const before = snapshot(row);
  console.log("\n=== BEFORE ===");
  console.log(`match_mode: ${matchMode}`);
  console.log(JSON.stringify(before, null, 2));

  assert(
    String(before.date) === EXPECTED_DATE,
    `Unexpected date ${before.date} (want ${EXPECTED_DATE})`,
  );
  // Manual staging posts may use category "Direct Operational" with description
  // "Employer SSNIT Contribution" (not the auto-post category name).
  assert(
    String(before.expense_category) === CATEGORY ||
      /employer\s*ssnit/i.test(String(before.expense_category)) ||
      /employer\s*ssnit/i.test(String(before.description)),
    `Unexpected category/description: cat=${before.expense_category} desc=${before.description}`,
  );
  assert(
    Math.abs(before.amount - APPROX_CURRENT) < 5 ||
      Math.abs(before.amount - TARGET_AMOUNT) < 0.01,
    `Amount ${before.amount} not near ${APPROX_CURRENT} or already ${TARGET_AMOUNT}`,
  );

  if (Math.abs(before.amount - TARGET_AMOUNT) < 0.005) {
    console.log("\nAlready at target amount — skipping UPDATE.");
  } else {
    // Schema stores amount alone for display; payroll path also sets price=amount, quantity=1.
    // Keep price in sync so price*quantity remains consistent if UI recomputes.
    const qty = before.quantity > 0 ? before.quantity : 1;
    const newPrice = Math.round((TARGET_AMOUNT / qty) * 100) / 100;

    const { error: updateErr } = await admin
      .from("expense_register")
      .update({
        amount: TARGET_AMOUNT,
        price: newPrice,
      })
      .eq("id", before.id)
      .eq("tenant_id", DAVORS_TENANT_ID);

    if (updateErr) throw new Error(`update failed: ${updateErr.message}`);
    console.log(
      `\nUPDATED amount ${before.amount} -> ${TARGET_AMOUNT}, price ${before.price} -> ${newPrice}`,
    );
  }

  const { data: afterRow, error: afterErr } = await admin
    .from("expense_register")
    .select(SELECT_COLS)
    .eq("id", before.id)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .single();

  if (afterErr) throw new Error(`verify read: ${afterErr.message}`);
  const after = snapshot(afterRow as unknown as Record<string, unknown>);

  console.log("\n=== AFTER ===");
  console.log(JSON.stringify(after, null, 2));

  assert(Math.abs(after.amount - TARGET_AMOUNT) < 0.005, "amount not 445.31");
  assert(String(after.date) === EXPECTED_DATE, "date changed");
  assert(after.expense_category === before.expense_category, "category changed");
  assert(after.description === before.description, "description changed");
  assert(after.vendor === before.vendor, "vendor changed");
  assert(after.sub_category === before.sub_category, "sub_category changed");
  assert(after.receipt_no === before.receipt_no, "receipt_no changed");
  assert(after.payment_status === before.payment_status, "payment_status changed");
  assert(after.payment_method === before.payment_method, "payment_method changed");
  assert(after.approved_by === before.approved_by, "approved_by changed");
  assert(after.notes === before.notes, "notes changed");
  assert(after.quantity === before.quantity, "quantity changed");
  assert(
    after.input_vat_amount === before.input_vat_amount,
    "input_vat_amount changed",
  );
  assert(after.wht_amount === before.wht_amount, "wht_amount changed");

  // --- Double-counting analysis (read-only) ---
  console.log("\n=== Double-counting analysis (read-only) ===");

  const { data: taxFromExpense, error: taxExpErr } = await admin
    .from("tax_ledger_entries")
    .select(
      "id, direction, tax_component, tax_amount, status, source_type, source_id, period_month",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("source_type", "expense_register")
    .eq("source_id", before.id);

  if (taxExpErr) throw new Error(`tax from expense: ${taxExpErr.message}`);

  console.log(
    `tax_ledger_entries with source_type=expense_register + this expense id: ${(taxFromExpense ?? []).length}`,
  );
  for (const t of taxFromExpense ?? []) {
    console.log(
      `  ${t.direction}/${t.tax_component} amount=${t.tax_amount} status=${t.status}`,
    );
  }

  const { data: juneStatutory, error: junStatErr } = await admin
    .from("tax_ledger_entries")
    .select(
      "id, direction, tax_component, tax_amount, status, source_type, period_month, counterparty_name",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("period_month", PERIOD_MONTH)
    .eq("direction", "statutory_payable")
    .in("tax_component", [
      "ssnit_employer_tier1",
      "ssnit_tier2",
      "ssnit_employee",
      "paye",
    ])
    .neq("status", "reversed");

  if (junStatErr) throw new Error(`june statutory: ${junStatErr.message}`);

  const tier1 = (juneStatutory ?? []).filter(
    (r) => r.tax_component === "ssnit_employer_tier1",
  );
  const tier2 = (juneStatutory ?? []).filter(
    (r) => r.tax_component === "ssnit_tier2",
  );
  const sumTier1 = tier1.reduce((s, r) => s + num(r.tax_amount), 0);
  const sumTier2 = tier2.reduce((s, r) => s + num(r.tax_amount), 0);

  console.log("\nJune statutory_payable (non-reversed):");
  for (const r of juneStatutory ?? []) {
    console.log(
      `  ${r.tax_component} ${r.tax_amount} source=${r.source_type} status=${r.status}`,
    );
  }
  console.log(
    `ssnit_employer_tier1 sum=${sumTier1.toFixed(2)} (n=${tier1.length})`,
  );
  console.log(`ssnit_tier2 sum=${sumTier2.toFixed(2)} (n=${tier2.length})`);
  console.log(
    `tier1+tier2 remittance liability = ${(sumTier1 + sumTier2).toFixed(2)}`,
  );
  console.log(`expense_register P&L cost (this row) = ${after.amount.toFixed(2)}`);

  const expenseHasInputTax =
    num(after.input_vat_amount) > 0 || num(after.wht_amount) > 0;
  const expenseWroteStatutory = (taxFromExpense ?? []).some(
    (t) =>
      t.direction === "statutory_payable" ||
      String(t.tax_component).startsWith("ssnit"),
  );

  console.log("\n=== Verdict ===");
  console.log(
    `expense has input_vat/wht columns set: ${expenseHasInputTax ? "YES (unexpected)" : "NO (good)"}`,
  );
  console.log(
    `expense path wrote statutory/ssnit tax_ledger legs: ${expenseWroteStatutory ? "YES (duplicate risk)" : "NO (good)"}`,
  );
  console.log(
    "Design: expense_register = P&L cost; payroll_period statutory_payable = remittance liability tracking.",
  );
  console.log(
    "OK as designed if those are separate purposes and expense does not also write statutory_payable legs.",
  );
  console.log("\nExplicit: staging only; production not touched.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
