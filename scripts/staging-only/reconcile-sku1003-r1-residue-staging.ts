/**
 * Reverse test-only SKU-1003 quantity left on BU rows after R1 cleanup (balanced write-offs).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";
const TECH = "d251c562-d522-43ec-8d9c-d1d00d4105b0";
const TARGET_FACILITIES = 271;

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("product_code", "SKU-1003")
    .single();
  if (!fp?.id) throw new Error("SKU-1003 missing");

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
  const userId = u.user.id;

  const { data: techBal } = await admin
    .from("finished_product_balances")
    .select("current_stock")
    .eq("product_id", fp.id)
    .eq("business_unit_id", TECH)
    .maybeSingle();
  const techQty = Number(techBal?.current_stock) || 0;
  if (techQty > 0) {
    const { error } = await client.rpc("record_finished_product_manual_adjustment", {
      p_tenant_id: DAVORS,
      p_product_id: fp.id,
      p_business_unit_id: TECH,
      p_adjustment_type: "write_off",
      p_quantity_delta: -techQty,
      p_cost_per_unit: null,
      p_reason: "R1 cleanup Technologies mis-stamped API stock",
      p_notes: null,
      p_created_by: userId,
      p_manufacturing_date: null,
      p_expiration_date: null,
    });
    if (error) throw error;
    console.log(`Technologies write-off ${techQty} units`);
  }

  const { data: facBal } = await admin
    .from("finished_product_balances")
    .select("current_stock")
    .eq("product_id", fp.id)
    .eq("business_unit_id", FACILITIES)
    .maybeSingle();
  const facQty = Number(facBal?.current_stock) || 0;
  const trim = facQty - TARGET_FACILITIES;
  if (trim > 0) {
    const { error } = await client.rpc("record_finished_product_manual_adjustment", {
      p_tenant_id: DAVORS,
      p_product_id: fp.id,
      p_business_unit_id: FACILITIES,
      p_adjustment_type: "write_off",
      p_quantity_delta: -trim,
      p_cost_per_unit: null,
      p_reason: "R1 cleanup Facilities test net stock",
      p_notes: null,
      p_created_by: userId,
      p_manufacturing_date: null,
      p_expiration_date: null,
    });
    if (error) throw error;
    console.log(`Facilities write-off ${trim} units (was ${facQty})`);
  }

  await admin.from("user_accounts").delete().eq("auth_uid", u.user.id);
  await admin.auth.admin.deleteUser(u.user.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
