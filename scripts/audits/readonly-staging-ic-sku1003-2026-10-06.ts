/**
 * Read-only staging: internal consumption + SKU-1003 @ Davors Facilities (2026-10-06).
 * npx tsx scripts/audits/readonly-staging-ic-sku1003-2026-10-06.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "00000001-0000-4000-8000-000000000001";

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
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
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bu } = await admin
    .from("business_units")
    .select("id,name")
    .eq("tenant_id", TENANT)
    .ilike("name", "%Facilities%")
    .maybeSingle();

  const { data: fp } = await admin
    .from("finished_products")
    .select("id,product_code,product_name,current_stock,unit_of_measure,sourcing_type")
    .eq("tenant_id", TENANT)
    .eq("product_code", "SKU-1003")
    .maybeSingle();

  console.log(JSON.stringify({ business_unit: bu, finished_product: fp }, null, 2));

  if (!fp) return;

  const { data: balances } = await admin
    .from("finished_product_balances")
    .select("*")
    .eq("product_id", fp.id);

  const icQuery = admin
    .from("internal_consumption")
    .select(
      "id,consumption_date,quantity,expense_register_id,product_id,business_unit_id,reason,notes,created_at",
    )
    .eq("tenant_id", TENANT)
    .eq("product_id", fp.id)
    .eq("consumption_date", "2026-10-06");

  const { data: icRows } = bu?.id
    ? await icQuery.eq("business_unit_id", bu.id)
    : await icQuery;

  const expenseIds = (icRows ?? [])
    .map((r) => r.expense_register_id)
    .filter(Boolean) as string[];

  let expenses: unknown[] = [];
  if (expenseIds.length) {
    const { data: exp } = await admin
      .from("expense_register")
      .select("id,date,amount,quantity,price,description,notes")
      .in("id", expenseIds);
    expenses = exp ?? [];
  }

  const icIds = (icRows ?? []).map((r) => r.id);
  let movements: unknown[] = [];
  if (icIds.length) {
    const { data: sm } = await admin
      .from("stock_movements")
      .select("id,movement_type,quantity,movement_date,reference_id,business_unit_id,notes")
      .eq("movement_type", "internal_consumption_out")
      .in("reference_id", icIds);
    movements = sm ?? [];
  }

  const buBalance = (balances ?? []).find(
    (b) => b.business_unit_id === bu?.id || (!bu?.id && !b.business_unit_id),
  );

  console.log(
    JSON.stringify(
      {
        finished_product_balances: balances,
        facilities_balance_row: buBalance,
        internal_consumption_2026_10_06: icRows,
        linked_expenses: expenses,
        stock_movements_ic_out: movements,
        consistency: {
          ic_qty_71: (icRows ?? []).some((r) => Number(r.quantity) === 71),
          movement_qty_matches_ic:
            movements.length === icRows?.length &&
            (icRows ?? []).every((ic) =>
              (movements as { reference_id: string; quantity: number }[]).some(
                (m) =>
                  m.reference_id === ic.id &&
                  Number(m.quantity) === Number(ic.quantity),
              ),
            ),
          expense_linked:
            (icRows ?? []).length === 0 ||
            (icRows ?? []).every(
              (ic) =>
                ic.expense_register_id &&
                (expenses as { id: string }[]).some(
                  (e) => e.id === ic.expense_register_id,
                ),
            ),
        },
      },
      null,
      2,
    ),
  );
}

main();
