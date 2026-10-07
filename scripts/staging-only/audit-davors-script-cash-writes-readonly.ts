/**
 * Read-only: list Davors rows likely touched by staging scripts (cash / payroll postings).
 *
 * npx tsx scripts/staging-only/audit-davors-script-cash-writes-readonly.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";
const SINCE = "2026-10-06T00:00:00Z";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const tables: Array<{ name: string; query: () => Promise<unknown> }> = [
    {
      name: "expense_register (payroll receipts, recent)",
      query: async () =>
        admin
          .from("expense_register")
          .select(
            "id, date, receipt_no, amount, payment_status, expense_category, business_unit_id, created_at, notes",
          )
          .eq("tenant_id", DAVORS)
          .or("receipt_no.ilike.PAYROLL-%,notes.ilike.%Release 1%")
          .gte("created_at", SINCE)
          .order("created_at", { ascending: false }),
    },
    {
      name: "income_register (payroll DEDSAV, recent)",
      query: async () =>
        admin
          .from("income_register")
          .select("id, date, invoice_no, amount, payment_status, business_unit_id, created_at, notes")
          .eq("tenant_id", DAVORS)
          .ilike("invoice_no", "PAYROLL-%")
          .gte("created_at", SINCE)
          .order("created_at", { ascending: false }),
    },
    {
      name: "payroll_history Jul 2026 Facilities",
      query: async () =>
        admin
          .from("payroll_history")
          .select("employee_id, payroll_month, net_pay, locked, created_at, updated_at")
          .eq("tenant_id", DAVORS)
          .eq("payroll_month", "2026-07-01"),
    },
    {
      name: "month_end_close Jul–Oct 2026 Facilities",
      query: async () =>
        admin
          .from("month_end_close")
          .select("month, lock_status, notes, total_net_pay, employees_recorded, business_unit_id")
          .eq("tenant_id", DAVORS)
          .eq("business_unit_id", FACILITIES)
          .gte("month", "2026-07-01")
          .lte("month", "2026-10-01"),
    },
    {
      name: "salary_advance_register (recent)",
      query: async () =>
        admin
          .from("salary_advance_register")
          .select("id, advance_date, amount, business_unit_id, created_at, notes")
          .eq("tenant_id", DAVORS)
          .gte("created_at", SINCE)
          .order("created_at", { ascending: false }),
    },
  ];

  for (const block of tables) {
    const { data, error } = (await block.query()) as {
      data: unknown;
      error: { message: string } | null;
    };
    console.log(`\n=== ${block.name} ===`);
    if (error) {
      console.log("error:", error.message);
      continue;
    }
    console.log(JSON.stringify(data, null, 2));
  }

  const { data: julSal } = await admin
    .from("expense_register")
    .select("receipt_no, amount, payment_status, business_unit_id, notes")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", "PAYROLL-SAL-2026-07")
    .maybeSingle();
  console.log("\n=== Jul 2026 PAYROLL-SAL row (Facilities cash impact) ===");
  console.log(JSON.stringify(julSal, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
