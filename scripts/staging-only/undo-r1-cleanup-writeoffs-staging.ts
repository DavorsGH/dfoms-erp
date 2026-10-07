/**
 * Remove R1 cleanup write-off rows (register reversal) and restore Facilities stock to 271.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const stamp = Date.now();
  const email = `r1.cleanup.${stamp}@test.davors`;
  const password = `R1Cln-${stamp}!Aa9`;
  const { data: u, error: cu } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cu || !u.user) throw cu ?? new Error("createUser");
  await admin.from("user_accounts").insert({
    auth_uid: u.user.id,
    email,
    tenant_id: DAVORS,
    role: "super_admin",
    is_active: true,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });

  const { data: rows } = await admin
    .from("finished_product_stock_adjustments")
    .select("id, reason")
    .eq("tenant_id", DAVORS)
    .ilike("reason", "%R1 cleanup%");
  for (const row of rows ?? []) {
    const { error } = await client
      .from("finished_product_stock_adjustments")
      .delete()
      .eq("id", row.id);
    console.log("delete adj", row.id, error?.message ?? "OK");
  }

  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("product_code", "SKU-1003")
    .eq("tenant_id", DAVORS)
    .single();

  const { data: facBal } = await admin
    .from("finished_product_balances")
    .select("current_stock, average_cost_per_unit")
    .eq("product_id", fp!.id)
    .eq("business_unit_id", FACILITIES)
    .maybeSingle();
  const qty = Number(facBal?.current_stock) || 0;
  const need = 271 - qty;
  if (need > 0 && fp?.id) {
    const cost = Number(facBal?.average_cost_per_unit) || 0.779;
    const { error } = await client.rpc("record_finished_product_manual_adjustment", {
      p_tenant_id: DAVORS,
      p_product_id: fp.id,
      p_business_unit_id: FACILITIES,
      p_adjustment_type: "found_stock",
      p_quantity_delta: need,
      p_cost_per_unit: cost,
      p_reason: "R1 staging stock reconcile to 271",
      p_notes: null,
      p_created_by: u.user!.id,
      p_manufacturing_date: null,
      p_expiration_date: null,
    });
    if (error) throw error;
    console.log(`found_stock +${need} @ ${cost}`);
  }

  await admin.from("user_accounts").delete().eq("auth_uid", u.user!.id);
  await admin.auth.admin.deleteUser(u.user!.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
