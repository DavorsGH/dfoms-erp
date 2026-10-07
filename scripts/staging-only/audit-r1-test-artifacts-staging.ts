/**
 * List R1 / Release 1 test artifacts on staging Davors (+ Caanta).
 * npx tsx scripts/staging-only/audit-r1-test-artifacts-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const fpAdj = await admin
    .from("finished_product_stock_adjustments")
    .select("id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, created_at")
    .eq("tenant_id", DAVORS)
    .or("reason.ilike.%R1 user test%,reason.ilike.%R1 API%");
  console.log("\n=== FP adjustments (Davors) ===", fpAdj.data?.length);
  console.log(fpAdj.data);

  const rmAdj = await admin
    .from("raw_material_stock_adjustments")
    .select("id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, created_at")
    .eq("tenant_id", DAVORS)
    .ilike("reason", "%R1 user test%");
  console.log("\n=== RM adjustments (Davors) ===", rmAdj.data?.length);
  console.log(rmAdj.data);

  const batches = await admin
    .from("production_batches")
    .select("id, batch_number, business_unit_id, production_date, notes")
    .eq("tenant_id", DAVORS)
    .or("batch_number.ilike.R1T-%,notes.ilike.%R1 user batch%");
  console.log("\n=== Production batches ===", batches.data?.length);
  console.log(batches.data);

  const ic = await admin
    .from("internal_consumption")
    .select("id, business_unit_id, consumption_date, quantity, reason")
    .eq("tenant_id", DAVORS)
    .ilike("reason", "%R1%");
  console.log("\n=== Internal consumption ===", ic.data?.length);
  console.log(ic.data);

  const links = await admin
    .from("inventory_stock_adjustment_register_links")
    .select("id, source_kind, adjustment_id, amount, income_register_id, expense_register_id")
    .eq("tenant_id", DAVORS);
  console.log("\n=== Register links (all Davors) ===", links.data?.length);

  const inc = await admin
    .from("income_register")
    .select("id, invoice_no, amount, business_unit_id, date, description, notes")
    .eq("tenant_id", DAVORS)
    .ilike("description", "%stock adjustment%")
    .gte("date", "2026-10-01");
  console.log("\n=== Oct+ inventory gain income ===", inc.data?.length);
  console.log(inc.data);

  const users = await admin
    .from("user_accounts")
    .select("auth_uid, email, tenant_id, role")
    .or("email.ilike.r1-mut.%,email.ilike.r1.adv.%,email.ilike.r1.mat.%,email.ilike.r1.icdel.%");
  console.log("\n=== Test user_accounts ===", users.data?.length);
  console.log(users.data);

  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS);
  console.log("\nBUs:", bus);

  const { data: stock } = await admin
    .from("finished_product_master_stock")
    .select("quantity_on_hand, business_unit_id")
    .eq("tenant_id", DAVORS)
    .eq("product_id", (
      await admin.from("finished_products").select("id").eq("product_code", "SKU-1003").single()
    ).data?.id);
  console.log("\nSKU-1003 master stock rows:", stock);

  const caantaAdv = await admin
    .from("salary_advance_register")
    .select("advance_id, amount, status, business_unit_id, date_issued")
    .eq("tenant_id", CAANTA);
  console.log("\n=== Caanta salary advances ===", caantaAdv.data?.length);
  console.log(caantaAdv.data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
