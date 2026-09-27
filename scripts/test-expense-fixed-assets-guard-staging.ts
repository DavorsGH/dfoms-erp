/**
 * Staging: DB trigger blocks new Fixed Assets expense_register rows.
 *
 *   npx tsx scripts/test-expense-fixed-assets-guard-staging.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE } from "../utils/expense-register-category-guard";

const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) throw new Error("Staging only");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { error } = await admin.from("expense_register").insert({
    tenant_id: DAVORS,
    date: "2099-01-01",
    expense_category: "Fixed Assets",
    sub_category: "Fixed Asset Purchases",
    description: "GUARD-TEST",
    vendor: "GUARD-TEST",
    price: 1,
    quantity: 1,
    amount: 1,
    payment_method: "Cash",
    approved_by: "System",
    receipt_no: `GUARD-TEST-${Date.now()}`,
    payment_status: "Paid",
    gross_before_wht: 1,
    net_of_tax_amount: 1,
  });

  if (!error) {
    throw new Error("Expected insert to be blocked");
  }
  if (!String(error.message).includes("Finance → Fixed Assets")) {
    throw new Error(`Unexpected error: ${error.message}`);
  }
  console.log("PASS: insert blocked with expected message");
  console.log(EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE.slice(0, 80), "…");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
