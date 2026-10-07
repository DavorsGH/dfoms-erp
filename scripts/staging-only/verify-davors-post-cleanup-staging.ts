/**
 * Verify Facilities Oct Direct Operational + SKU-1003 stock after R1 cleanup.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const EXPECTED_DIRECT_OP = 1818.5;
const EXPECTED_SKU1003 = 271;

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", DAVORS)
    .ilike("name", "%Facilities%")
    .single();
  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("product_code", "SKU-1003")
    .single();

  const { data: exp } = await admin
    .from("expense_register")
    .select("amount")
    .eq("tenant_id", DAVORS)
    .eq("business_unit_id", bu!.id)
    .eq("expense_category", "Direct Operational")
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");
  const directOp = Math.round(
    (exp ?? []).reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100,
  ) / 100;

  const { data: facBal } = await admin
    .from("finished_product_balances")
    .select("current_stock")
    .eq("tenant_id", DAVORS)
    .eq("product_id", fp!.id)
    .eq("business_unit_id", bu!.id)
    .maybeSingle();

  const facilitiesStock = Number(facBal?.current_stock) || 0;

  console.log("Facilities Oct Direct Operational:", directOp, `(expected ${EXPECTED_DIRECT_OP})`);
  console.log(
    "SKU-1003 Facilities finished_product_balances.current_stock:",
    facilitiesStock,
    `(expected ${EXPECTED_SKU1003})`,
  );

  if (Math.abs(directOp - EXPECTED_DIRECT_OP) > 0.01) {
    throw new Error("Direct Operational mismatch");
  }
  if (Math.abs(facilitiesStock - EXPECTED_SKU1003) > 0.01) {
    throw new Error("SKU-1003 Facilities stock mismatch");
  }
  console.log("PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
