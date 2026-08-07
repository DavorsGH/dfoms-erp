/**
 * Employee phone data quality for SMS MFA (staging).
 * Usage: npx tsx scripts/check-employee-phone-mfa-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

function hasUsablePhone(phone: unknown, momo: unknown): boolean {
  const pick = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  return pick(phone) || pick(momo);
}

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local"],
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected via ${envFile}`);

  try {
    const { rows } = await client.query(`
      SELECT
        COUNT(*)::text AS total_active,
        COUNT(*) FILTER (
          WHERE NULLIF(TRIM(COALESCE(phone, '')), '') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(momo_number, '')), '') IS NOT NULL
        )::text AS with_phone
      FROM public.employees
      WHERE employment_status ILIKE 'Active'
    `);

    const total = Number(rows[0]?.total_active ?? 0);
    const withPhone = Number(rows[0]?.with_phone ?? 0);
    const pct = total > 0 ? ((withPhone / total) * 100).toFixed(1) : "0.0";

    console.log("Active employees (employment_status = Active):", total);
    console.log("With phone or momo_number populated:", withPhone);
    console.log("Percentage:", `${pct}%`);

    const { rows: linked } = await client.query(`
      SELECT
        COUNT(DISTINCT ua.auth_uid)::text AS staff_with_accounts,
        COUNT(DISTINCT ua.auth_uid) FILTER (
          WHERE NULLIF(TRIM(COALESCE(e.phone, '')), '') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(e.momo_number, '')), '') IS NOT NULL
        )::text AS staff_with_phone
      FROM public.user_accounts ua
      JOIN public.employees e ON e.employee_id = ua.employee_id
      WHERE ua.is_active IS NOT FALSE
        AND e.employment_status ILIKE 'Active'
    `);

    const staffAccounts = Number(linked[0]?.staff_with_accounts ?? 0);
    const staffWithPhone = Number(linked[0]?.staff_with_phone ?? 0);
    const staffPct =
      staffAccounts > 0
        ? ((staffWithPhone / staffAccounts) * 100).toFixed(1)
        : "0.0";

    console.log("\nActive staff ERP accounts (user_accounts + Active employee):", staffAccounts);
    console.log("Those with employee phone/momo:", staffWithPhone);
    console.log("Percentage:", `${staffPct}%`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
