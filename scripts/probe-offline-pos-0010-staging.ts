/**
 * Read-only: trace offline conflict resolution path for DF-POS-0010.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CLIENT_OP_ID = "8858ff4f-d986-4771-a010-67d925dc7a82";
const PRODUCT_ID = "95f26ef4-df93-4c90-9b8b-947f37ed0421";

function loadEnv(f) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const [{ data: posOp }, { data: conflicts }, { data: movements }] = await Promise.all([
    admin
      .from("offline_pos_ops")
      .select("*")
      .eq("client_op_id", CLIENT_OP_ID)
      .maybeSingle(),
    admin
      .from("offline_sale_conflicts")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("client_op_id", CLIENT_OP_ID),
    admin
      .from("stock_movements")
      .select("*")
      .eq("product_id", PRODUCT_ID)
      .order("movement_date"),
  ]);

  console.log("offline_pos_ops:", posOp);
  console.log("\noffline_sale_conflicts:", conflicts);
  console.log("\nstock_movements:", movements);

  const { data: wac } = await admin.rpc("finished_product_weighted_avg_cost", {
    p_product_id: PRODUCT_ID,
  });
  console.log("\nfinished_product_weighted_avg_cost (now):", wac);
}

main();
