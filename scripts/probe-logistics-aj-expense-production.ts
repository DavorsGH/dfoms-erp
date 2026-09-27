/**
 * Read-only: Davors Logistics Sep 2026 AJ expenses + manual financial row.
 *
 *   npx tsx scripts/probe-logistics-aj-expense-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000001-0000-4000-8000-000000000001";
const LOGISTICS_BU = "2ae591d2-0f89-44d0-83af-1133cfe7a32c";

function loadEnv(file: string) {
  for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv(".env.local.backup");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("tvcurcnmasnocwdxzgvz")) {
    throw new Error("Production URL required (.env.local.backup)");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", TENANT_ID)
    .maybeSingle();
  console.log("Tenant:", tenant);

  const { data: bu } = await admin
    .from("business_units")
    .select("id, name")
    .eq("id", LOGISTICS_BU)
    .maybeSingle();
  console.log("Business unit:", bu);

  const expenseTargets = [
    { date: "2026-09-18", amount: 6000, description: "AJ Expense" },
    { date: "2026-09-21", amount: 2000, description: "Miscellaneous Expense" },
  ];

  for (const target of expenseTargets) {
    const { data: rows } = await admin
      .from("expense_register")
      .select(
        "id, receipt_no, date, amount, expense_category, sub_category, description, notes, business_unit_id",
      )
      .eq("tenant_id", TENANT_ID)
      .eq("business_unit_id", LOGISTICS_BU)
      .eq("date", target.date);
    const match = (rows ?? []).filter(
      (r) =>
        Math.abs(Number(r.amount) - target.amount) < 0.01 &&
        String(r.description ?? "")
          .toLowerCase()
          .includes(target.description.toLowerCase().slice(0, 4)),
    );
    console.log(`\n--- ${target.date} GHS ${target.amount} (${target.description}) ---`);
    console.log("expense_register:", match);
    for (const row of match) {
      const { data: ic } = await admin
        .from("internal_consumption")
        .select("id, expense_register_id")
        .eq("expense_register_id", row.id)
        .maybeSingle();
      console.log({
        id: row.id,
        receipt_no: row.receipt_no,
        category: row.expense_category,
        sub_category: row.sub_category,
        linked_internal_consumption: ic?.id ?? null,
      });
    }
  }

  const { data: manualSep } = await admin
    .from("manual_financial_entries")
    .select("id, period_month, business_unit_id, bank_loans, directors_loan, loan_proceeds, notes")
    .eq("tenant_id", TENANT_ID)
    .eq("business_unit_id", LOGISTICS_BU)
    .eq("period_month", "2026-09-01");
  console.log("\n--- Manual financial entry Logistics Sep 2026 ---");
  console.log(manualSep);

  for (const date of ["2026-09-18", "2026-09-21"]) {
    const { data: anyBu } = await admin
      .from("expense_register")
      .select("id, receipt_no, date, amount, description, expense_category, sub_category, business_unit_id")
      .eq("tenant_id", TENANT_ID)
      .eq("date", date);
    console.log(`\nAll tenant expenses on ${date}:`, anyBu);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
