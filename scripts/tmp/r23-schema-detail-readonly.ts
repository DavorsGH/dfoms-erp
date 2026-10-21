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

async function main() {
  loadEnvForce(".env.staging.local");
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl()!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const checks = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.remote_work_arrangements'::regclass
    `);
    console.log("arr constraints", JSON.stringify(checks.rows, null, 2));

    const modeCheck = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.employees'::regclass
        AND pg_get_constraintdef(oid) ILIKE '%attendance_mode%'
    `);
    console.log("attendance_mode check", JSON.stringify(modeCheck.rows, null, 2));

    const pp = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='payroll_processing'
      ORDER BY ordinal_position
    `);
    console.log(
      "payroll_processing cols",
      pp.rows.map((r) => r.column_name).join(", "),
    );

    const sample = await client.query(
      `SELECT * FROM remote_work_arrangements LIMIT 3`,
    );
    console.log("sample arrangements", JSON.stringify(sample.rows, null, 2));

    // Welfare before/after without business_unit on processing
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
        ) AS include_ot,
        coalesce(mec.lock_status, 'Open') AS lock_status
      FROM payroll_processing pp
      JOIN employees e
        ON e.employee_id = pp.employee_id AND e.tenant_id = pp.tenant_id
      LEFT JOIN month_end_close mec
        ON mec.tenant_id = pp.tenant_id
       AND mec.month = DATE '2026-10-01'
      WHERE pp.payroll_month = DATE '2026-10-01'
        AND coalesce(e.welfare_deduction_rate, 0) > 0
        AND coalesce(pp.absence_deduction, 0) > 0
        AND coalesce(mec.lock_status, 'Open') = 'Open'
      ORDER BY e.staff_id
    `);

    function round2(n: number) {
      return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    console.log("\nstaff_id | name | rate% | absence | before | after | delta | stored");
    let changed = 0;
    for (const r of rows.rows) {
      const absence = Number(r.absence);
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
    console.log(
      `\n${changed} with welfare change / ${rows.rows.length} with rate>0 & absence>0 open`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
