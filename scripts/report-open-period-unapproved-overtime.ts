/**
 * Count overtime_register rows in open payroll months with approved_by null.
 * Usage: npx tsx scripts/report-open-period-unapproved-overtime.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file .env.staging.local)",
    );
  }
  const admin = createClient(url, key);

  const { data: openMonths, error: monthsError } = await admin
    .from("payroll_processing")
    .select("tenant_id, payroll_month")
    .eq("status", "Open");

  if (monthsError) {
    throw new Error(monthsError.message);
  }

  const monthKeys = new Set<string>();
  for (const row of openMonths ?? []) {
    const month = String(row.payroll_month ?? "").slice(0, 10);
    if (month) {
      monthKeys.add(`${row.tenant_id}|${month}`);
    }
  }

  if (monthKeys.size === 0) {
    console.log("Open payroll periods: none");
    console.log("Unapproved overtime rows (approved_by null): 0");
    return;
  }

  let totalUnapproved = 0;
  const byMonth: { tenant_id: string; payroll_month: string; count: number }[] =
    [];

  for (const key of monthKeys) {
    const [tenant_id, payroll_month] = key.split("|");
    const year = Number.parseInt(payroll_month.slice(0, 4), 10);
    const month = Number.parseInt(payroll_month.slice(5, 7), 10);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

    const { count, error } = await admin
      .from("overtime_register")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .gte("date", start)
      .lte("date", end)
      .is("approved_by", null);

    if (error) {
      throw new Error(error.message);
    }

    const n = count ?? 0;
    totalUnapproved += n;
    if (n > 0) {
      byMonth.push({ tenant_id, payroll_month, count: n });
    }
  }

  console.log(`Open payroll period keys (tenant+month): ${monthKeys.size}`);
  console.log(
    `Unapproved overtime rows (approved_by null) in those months: ${totalUnapproved}`,
  );
  if (byMonth.length > 0) {
    console.log("Breakdown (non-zero only):");
    for (const row of byMonth.sort((a, b) =>
      a.payroll_month.localeCompare(b.payroll_month),
    )) {
      console.log(
        `  ${row.payroll_month} tenant=${row.tenant_id} count=${row.count}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
