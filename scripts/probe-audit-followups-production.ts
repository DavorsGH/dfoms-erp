/**
 * Follow-up probes for production audit findings.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const NEXTRONICS = "da8b968e-dd42-48d5-93c5-a3147ff5de72";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });

  console.log("=== Davors payroll: gross vs net+paye+ssnit+other deductions ===");
  const davorsPayroll = await client.query(
    `
    SELECT to_char(payroll_month::date, 'YYYY-MM') AS ym,
           COUNT(*)::int AS rows,
           ROUND(SUM(gross_pay)::numeric, 2) AS gross,
           ROUND(SUM(net_pay)::numeric, 2) AS net,
           ROUND(SUM(paye_tax)::numeric, 2) AS paye,
           ROUND(SUM(employee_ssnit)::numeric, 2) AS emp_ssnit,
           ROUND(SUM(total_deductions)::numeric, 2) AS total_deductions,
           ROUND(SUM(loan_repayment)::numeric, 2) AS loan_repayment,
           ROUND(SUM(welfare_deduction)::numeric, 2) AS welfare,
           ROUND(SUM(other_deductions)::numeric, 2) AS other_ded,
           ROUND((SUM(gross_pay) - SUM(net_pay) - SUM(paye_tax) - SUM(employee_ssnit))::numeric, 2) AS non_statutory_gap
    FROM payroll_history
    WHERE tenant_id = $1
      AND to_char(payroll_month::date, 'YYYY-MM') IN ('2026-06', '2026-07', '2026-08')
    GROUP BY 1
    ORDER BY 1
    `,
    [DAVORS],
  );
  console.log(davorsPayroll.rows);

  console.log("\n=== Nextronics COGS / inventory expenses ===");
  const nextrCogs = await client.query(
    `
    SELECT receipt_no, date, amount, expense_category, sub_category, description
    FROM expense_register
    WHERE tenant_id = $1
      AND (receipt_no LIKE 'COGS-%' OR receipt_no LIKE 'VOID-COGS-%'
           OR expense_category ILIKE '%cost of goods%')
    ORDER BY date, receipt_no
    `,
    [NEXTRONICS],
  );
  console.log(nextrCogs.rows);

  console.log("\n=== Nextronics locked payroll months ===");
  const nextrLock = await client.query(
    `
    SELECT month, lock_status, employees_recorded, total_net_pay
    FROM month_end_close WHERE tenant_id = $1 ORDER BY month
    `,
    [NEXTRONICS],
  );
  console.log(nextrLock.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
