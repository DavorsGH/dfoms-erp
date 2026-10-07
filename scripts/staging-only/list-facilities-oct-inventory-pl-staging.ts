import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const TENANT = "00000001-0000-4000-8000-000000000001";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", TENANT)
    .ilike("name", "%Facilities%")
    .single();

  const { data: inc } = await admin
    .from("income_register")
    .select("id, amount, description, date, invoice_no")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", bu!.id)
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31")
    .ilike("description", "%stock adjustment%");
  console.log("Oct Facilities inventory gain income:", inc);

  const { data: exp } = await admin
    .from("expense_register")
    .select("id, amount, description, date, receipt_no, sub_category")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", bu!.id)
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31")
    .or("description.ilike.%stock adjustment%,sub_category.eq.Inventory loss");
  console.log("Oct Facilities inventory loss expense:", exp);

  const { data: links } = await admin
    .from("inventory_stock_adjustment_register_links")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("Register links count:", links?.length, links);
}

main();
