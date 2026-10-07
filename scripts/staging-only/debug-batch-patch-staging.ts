import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: batch } = await admin
    .from("production_batches")
    .select("id")
    .eq("tenant_id", "00000001-0000-4000-8000-000000000001")
    .ilike("notes", "%R1 HTTP batch%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!batch?.id) {
    console.log("No batch");
    return;
  }
  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("product_code", "SKU-1003")
    .single();
  const { data: mat } = await admin.from("raw_materials").select("id").limit(1).single();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin.rpc("update_production_batch", {
    p_tenant_id: "00000001-0000-4000-8000-000000000001",
    p_batch_id: batch.id,
    p_production_date: today,
    p_finished_product_id: fp!.id,
    p_quantity_produced: 2,
    p_notes: "debug",
    p_materials: [{ material_id: mat!.id, quantity_used: 0.002, cost_at_time: 1 }],
  });
  console.log(error ?? "OK");
}

main();
