import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(".env.staging.local") });
const D = "00000001-0000-4000-8000-000000000001";
const M = "2026-07-01";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const [{ count: h }, { count: p }, { data: mec }, { data: sal }] =
    await Promise.all([
      admin
        .from("payroll_history")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", D)
        .eq("payroll_month", M),
      admin
        .from("payroll_processing")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", D)
        .eq("payroll_month", M),
      admin
        .from("month_end_close")
        .select("*")
        .eq("tenant_id", D)
        .eq("month", M),
      admin
        .from("expense_register")
        .select("receipt_no, amount, payment_status")
        .eq("tenant_id", D)
        .eq("receipt_no", "PAYROLL-SAL-2026-07"),
    ]);
  console.log({ history: h, processing: p, mec, sal });
}

main();
