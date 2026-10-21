// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function main() {
  loadEnvForce(".env.staging.local");
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl()!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const mec = await client.query(`
      SELECT tenant_id, business_unit_id, lock_status, month
      FROM month_end_close WHERE month = DATE '2026-10-01'
    `);
    console.log("Oct MEC", JSON.stringify(mec.rows, null, 2));

    const counts = await client.query(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE coalesce(absence_deduction,0)>0)::int AS with_absence,
             count(*) FILTER (WHERE coalesce(welfare_deduction,0)>0)::int AS with_welfare
      FROM payroll_processing WHERE payroll_month = DATE '2026-10-01'
    `);
    console.log("Oct processing counts", counts.rows[0]);

    const patience = await client.query(`
      SELECT e.staff_id, e.full_name, e.welfare_deduction_rate,
             pp.absence_deduction, pp.gross_pay, pp.welfare_deduction,
             pp.paye_tax, pp.total_deductions, pp.net_pay, pp.overtime_amount,
             pp.bonuses, pp.arrears, pp.basic_salary, pp.days_to_pay, pp.daily_rate
      FROM payroll_processing pp
      JOIN employees e ON e.employee_id = pp.employee_id AND e.tenant_id = pp.tenant_id
      WHERE pp.payroll_month = DATE '2026-10-01'
        AND e.staff_id = 'DF0020'
    `);
    console.log("Patience DF0020", JSON.stringify(patience.rows, null, 2));

    // Recalc from live processing for all Oct rows with rate and (absence OR stored welfare)
    const rows = await client.query(`
      SELECT
        e.staff_id,
        e.full_name,
        coalesce(e.welfare_deduction_rate, 0)::numeric AS rate,
        coalesce(pp.absence_deduction, 0)::numeric AS absence,
        coalesce(pp.gross_pay, 0)::numeric AS gross_pay,
        coalesce(pp.overtime_amount, 0)::numeric AS overtime,
        coalesce(pp.welfare_deduction, 0)::numeric AS welfare_stored,
        coalesce(
          (
            SELECT h.include_overtime_in_welfare
            FROM hr_payroll_settings h
            WHERE h.tenant_id = pp.tenant_id
            ORDER BY h.business_unit_id NULLS LAST
            LIMIT 1
          ),
          true
        ) AS include_ot
      FROM payroll_processing pp
      JOIN employees e
        ON e.employee_id = pp.employee_id AND e.tenant_id = pp.tenant_id
      WHERE pp.payroll_month = DATE '2026-10-01'
        AND coalesce(e.welfare_deduction_rate, 0) > 0
      ORDER BY e.staff_id
    `);

    console.log("\nstaff_id | name | rate | absence | before | after | delta | stored");
    let changed = 0;
    for (const r of rows.rows) {
      const absence = Number(r.absence);
      if (absence <= 0) continue;
      const earned = Number(r.gross_pay);
      const preAbsence = round2(earned + absence);
      const ot = Number(r.overtime);
      const rate = Number(r.rate);
      let beforeBase = preAbsence;
      let afterBase = preAbsence;
      if (r.include_ot === false) {
        beforeBase = Math.max(beforeBase - ot, 0);
        afterBase = Math.max(afterBase - ot, 0);
      }
      afterBase = Math.max(afterBase - absence, 0);
      const before = round2((beforeBase * rate) / 100);
      const after = round2((afterBase * rate) / 100);
      if (before === after) continue;
      changed += 1;
      console.log(
        `${r.staff_id} | ${r.full_name} | ${rate} | ${absence.toFixed(2)} | ${before.toFixed(2)} | ${after.toFixed(2)} | ${round2(after - before).toFixed(2)} | ${Number(r.welfare_stored).toFixed(2)}`,
      );
    }
    console.log(`\n${changed} employees whose welfare changes (absence>0, rate>0)`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
