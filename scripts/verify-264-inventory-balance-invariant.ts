/**
 * Phase 7a inventory balance invariant checks (read-only).
 *
 * Usage:
 *   npx tsx scripts/verify-264-inventory-balance-invariant.ts --env staging
 *   npx tsx scripts/verify-264-inventory-balance-invariant.ts --env staging --mode A
 *   npx tsx scripts/verify-264-inventory-balance-invariant.ts --env staging --mode B
 *   npx tsx scripts/verify-264-inventory-balance-invariant.ts --env production --mode backfill
 *
 * Mode A (backfill, default): null-BU balances match masters (qty + value).
 * Mode B (dual-write): sum(all BU balances.qty) == sum(master.qty).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TOL = 0.0001;

export type Verify264Args = {
  environment: "staging" | "production";
  mode: "A" | "B";
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function parseArgs(argv: string[]): Verify264Args {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }

  const modeIdx = argv.indexOf("--mode");
  let modeRaw = modeIdx >= 0 ? (argv[modeIdx + 1] ?? "A") : "A";
  modeRaw = modeRaw.toLowerCase();
  let mode: "A" | "B";
  if (modeRaw === "a" || modeRaw === "backfill") mode = "A";
  else if (modeRaw === "b" || modeRaw === "dual-write" || modeRaw === "dualwrite")
    mode = "B";
  else throw new Error("--mode A|B (aliases: backfill, dual-write)");

  return { environment, mode };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOL;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

export async function runVerify264(
  args: Verify264Args,
): Promise<{ ok: boolean; failures: string[] }> {
  const envFile =
    args.environment === "production"
      ? ".env.local.backup"
      : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef =
    args.environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(expectedRef)) {
    throw new Error(
      `Refusing: NEXT_PUBLIC_SUPABASE_URL does not look like ${args.environment} (${expectedRef})`,
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  const failures: string[] = [];
  try {
    console.log(
      `verify-264 mode ${args.mode} on ${args.environment} (tol ${TOL})`,
    );

    if (args.mode === "A") {
      await runModeA(client, failures);
    } else {
      await runModeB(client, failures);
    }

    if (failures.length === 0) {
      console.log("PASS: all verify-264 checks");
    } else {
      console.error(`FAIL: ${failures.length} check(s) failed`);
      for (const f of failures) console.error(`  - ${f}`);
    }
    return { ok: failures.length === 0, failures };
  } finally {
    await client.end();
  }
}

async function runModeA(client: pg.Client, failures: string[]) {
  // 1) Exactly one null-BU balance per master
  const { rows: rmCoverage } = await client.query<{
    material_id: string;
    tenant_id: string;
    bal_count: string;
  }>(
    `
    SELECT rm.id AS material_id, rm.tenant_id,
           COUNT(b.id)::text AS bal_count
    FROM raw_materials rm
    LEFT JOIN raw_material_balances b
      ON b.material_id = rm.id
     AND b.tenant_id = rm.tenant_id
     AND b.business_unit_id IS NULL
    GROUP BY rm.id, rm.tenant_id
    HAVING COUNT(b.id) <> 1
    ORDER BY rm.tenant_id, rm.id
    LIMIT 50
    `,
  );
  if (rmCoverage.length === 0) {
    console.log("PASS: every raw_materials row has exactly one null-BU balance");
  } else {
    failures.push(
      `RM null-BU coverage: ${rmCoverage.length}+ masters without exactly one null-BU balance`,
    );
    for (const r of rmCoverage) {
      console.error(
        `  DIFF RM material=${r.material_id} tenant=${r.tenant_id} null_bu_count=${r.bal_count}`,
      );
    }
  }

  const { rows: fpCoverage } = await client.query<{
    product_id: string;
    tenant_id: string;
    bal_count: string;
  }>(
    `
    SELECT fp.id AS product_id, fp.tenant_id,
           COUNT(b.id)::text AS bal_count
    FROM finished_products fp
    LEFT JOIN finished_product_balances b
      ON b.product_id = fp.id
     AND b.tenant_id = fp.tenant_id
     AND b.business_unit_id IS NULL
    GROUP BY fp.id, fp.tenant_id
    HAVING COUNT(b.id) <> 1
    ORDER BY fp.tenant_id, fp.id
    LIMIT 50
    `,
  );
  if (fpCoverage.length === 0) {
    console.log(
      "PASS: every finished_products row has exactly one null-BU balance",
    );
  } else {
    failures.push(
      `FP null-BU coverage: ${fpCoverage.length}+ masters without exactly one null-BU balance`,
    );
    for (const r of fpCoverage) {
      console.error(
        `  DIFF FP product=${r.product_id} tenant=${r.tenant_id} null_bu_count=${r.bal_count}`,
      );
    }
  }

  // 2) Per-tenant null-BU qty sums
  const { rows: rmQty } = await client.query<{
    tenant_id: string;
    master_qty: string;
    bal_qty: string;
  }>(
    `
    SELECT t.tenant_id,
           COALESCE(m.qty, 0)::text AS master_qty,
           COALESCE(b.qty, 0)::text AS bal_qty
    FROM (
      SELECT tenant_id FROM raw_materials
      UNION
      SELECT tenant_id FROM raw_material_balances WHERE business_unit_id IS NULL
    ) t
    LEFT JOIN (
      SELECT tenant_id, SUM(current_stock) AS qty FROM raw_materials GROUP BY tenant_id
    ) m ON m.tenant_id = t.tenant_id
    LEFT JOIN (
      SELECT tenant_id, SUM(current_stock) AS qty
      FROM raw_material_balances WHERE business_unit_id IS NULL
      GROUP BY tenant_id
    ) b ON b.tenant_id = t.tenant_id
    ORDER BY t.tenant_id
    `,
  );
  let rmQtyOk = true;
  for (const r of rmQty) {
    const mq = num(r.master_qty);
    const bq = num(r.bal_qty);
    if (!near(mq, bq)) {
      rmQtyOk = false;
      failures.push(
        `RM null-BU qty tenant=${r.tenant_id}: master=${mq} bal=${bq} delta=${bq - mq}`,
      );
      console.error(
        `  DIFF RM qty tenant=${r.tenant_id} master=${mq} bal=${bq}`,
      );
    }
  }
  if (rmQtyOk) console.log("PASS: per-tenant RM null-BU qty == master qty");

  const { rows: fpQty } = await client.query<{
    tenant_id: string;
    master_qty: string;
    bal_qty: string;
  }>(
    `
    SELECT t.tenant_id,
           COALESCE(m.qty, 0)::text AS master_qty,
           COALESCE(b.qty, 0)::text AS bal_qty
    FROM (
      SELECT tenant_id FROM finished_products
      UNION
      SELECT tenant_id FROM finished_product_balances WHERE business_unit_id IS NULL
    ) t
    LEFT JOIN (
      SELECT tenant_id, SUM(current_stock) AS qty FROM finished_products GROUP BY tenant_id
    ) m ON m.tenant_id = t.tenant_id
    LEFT JOIN (
      SELECT tenant_id, SUM(current_stock) AS qty
      FROM finished_product_balances WHERE business_unit_id IS NULL
      GROUP BY tenant_id
    ) b ON b.tenant_id = t.tenant_id
    ORDER BY t.tenant_id
    `,
  );
  let fpQtyOk = true;
  for (const r of fpQty) {
    const mq = num(r.master_qty);
    const bq = num(r.bal_qty);
    if (!near(mq, bq)) {
      fpQtyOk = false;
      failures.push(
        `FP null-BU qty tenant=${r.tenant_id}: master=${mq} bal=${bq} delta=${bq - mq}`,
      );
      console.error(
        `  DIFF FP qty tenant=${r.tenant_id} master=${mq} bal=${bq}`,
      );
    }
  }
  if (fpQtyOk) console.log("PASS: per-tenant FP null-BU qty == master qty");

  // Per-item qty diffs when tenant totals fail
  if (!rmQtyOk) {
    const { rows: itemDiffs } = await client.query<{
      tenant_id: string;
      material_id: string;
      master_qty: string;
      bal_qty: string;
    }>(
      `
      SELECT rm.tenant_id, rm.id AS material_id,
             rm.current_stock::text AS master_qty,
             COALESCE(b.current_stock, 0)::text AS bal_qty
      FROM raw_materials rm
      LEFT JOIN raw_material_balances b
        ON b.material_id = rm.id AND b.tenant_id = rm.tenant_id
       AND b.business_unit_id IS NULL
      WHERE ABS(rm.current_stock - COALESCE(b.current_stock, 0)) > $1
      ORDER BY rm.tenant_id, rm.id
      LIMIT 40
      `,
      [TOL],
    );
    for (const r of itemDiffs) {
      console.error(
        `  ITEM RM ${r.material_id} tenant=${r.tenant_id} master=${r.master_qty} bal=${r.bal_qty}`,
      );
    }
  }
  if (!fpQtyOk) {
    const { rows: itemDiffs } = await client.query<{
      tenant_id: string;
      product_id: string;
      master_qty: string;
      bal_qty: string;
    }>(
      `
      SELECT fp.tenant_id, fp.id AS product_id,
             fp.current_stock::text AS master_qty,
             COALESCE(b.current_stock, 0)::text AS bal_qty
      FROM finished_products fp
      LEFT JOIN finished_product_balances b
        ON b.product_id = fp.id AND b.tenant_id = fp.tenant_id
       AND b.business_unit_id IS NULL
      WHERE ABS(fp.current_stock - COALESCE(b.current_stock, 0)) > $1
      ORDER BY fp.tenant_id, fp.id
      LIMIT 40
      `,
      [TOL],
    );
    for (const r of itemDiffs) {
      console.error(
        `  ITEM FP ${r.product_id} tenant=${r.tenant_id} master=${r.master_qty} bal=${r.bal_qty}`,
      );
    }
  }

  // 3) RM value: sum(qty*avg)
  const { rows: rmVal } = await client.query<{
    tenant_id: string;
    master_value: string;
    bal_value: string;
  }>(
    `
    SELECT t.tenant_id,
           COALESCE(m.val, 0)::text AS master_value,
           COALESCE(b.val, 0)::text AS bal_value
    FROM (
      SELECT tenant_id FROM raw_materials
      UNION
      SELECT tenant_id FROM raw_material_balances WHERE business_unit_id IS NULL
    ) t
    LEFT JOIN (
      SELECT tenant_id,
             SUM(current_stock * average_cost_per_unit) AS val
      FROM raw_materials GROUP BY tenant_id
    ) m ON m.tenant_id = t.tenant_id
    LEFT JOIN (
      SELECT tenant_id,
             SUM(current_stock * average_cost_per_unit) AS val
      FROM raw_material_balances WHERE business_unit_id IS NULL
      GROUP BY tenant_id
    ) b ON b.tenant_id = t.tenant_id
    ORDER BY t.tenant_id
    `,
  );
  let rmValOk = true;
  for (const r of rmVal) {
    const mv = num(r.master_value);
    const bv = num(r.bal_value);
    if (!near(mv, bv)) {
      rmValOk = false;
      failures.push(
        `RM null-BU value tenant=${r.tenant_id}: master=${mv} bal=${bv} delta=${bv - mv}`,
      );
      console.error(
        `  DIFF RM value tenant=${r.tenant_id} master=${mv} bal=${bv}`,
      );
    }
  }
  if (rmValOk) console.log("PASS: per-tenant RM null-BU value == master value");

  if (!rmValOk) {
    const { rows: itemDiffs } = await client.query<{
      tenant_id: string;
      material_id: string;
      master_value: string;
      bal_value: string;
    }>(
      `
      SELECT rm.tenant_id, rm.id AS material_id,
             (rm.current_stock * rm.average_cost_per_unit)::text AS master_value,
             (COALESCE(b.current_stock, 0) * COALESCE(b.average_cost_per_unit, 0))::text AS bal_value
      FROM raw_materials rm
      LEFT JOIN raw_material_balances b
        ON b.material_id = rm.id AND b.tenant_id = rm.tenant_id
       AND b.business_unit_id IS NULL
      WHERE ABS(
        rm.current_stock * rm.average_cost_per_unit
        - COALESCE(b.current_stock, 0) * COALESCE(b.average_cost_per_unit, 0)
      ) > $1
      ORDER BY rm.tenant_id, rm.id
      LIMIT 40
      `,
      [TOL],
    );
    for (const r of itemDiffs) {
      console.error(
        `  ITEM RM value ${r.material_id} tenant=${r.tenant_id} master=${r.master_value} bal=${r.bal_value}`,
      );
    }
  }

  // 4) FP value: bal uses stored avg; master uses WAC RPC
  const { rows: fpVal } = await client.query<{
    tenant_id: string;
    master_value: string;
    bal_value: string;
  }>(
    `
    SELECT t.tenant_id,
           COALESCE(m.val, 0)::text AS master_value,
           COALESCE(b.val, 0)::text AS bal_value
    FROM (
      SELECT tenant_id FROM finished_products
      UNION
      SELECT tenant_id FROM finished_product_balances WHERE business_unit_id IS NULL
    ) t
    LEFT JOIN (
      SELECT fp.tenant_id,
             SUM(
               fp.current_stock * COALESCE(public.finished_product_weighted_avg_cost(fp.id), 0)
             ) AS val
      FROM finished_products fp
      GROUP BY fp.tenant_id
    ) m ON m.tenant_id = t.tenant_id
    LEFT JOIN (
      SELECT tenant_id,
             SUM(current_stock * average_cost_per_unit) AS val
      FROM finished_product_balances WHERE business_unit_id IS NULL
      GROUP BY tenant_id
    ) b ON b.tenant_id = t.tenant_id
    ORDER BY t.tenant_id
    `,
  );
  let fpValOk = true;
  for (const r of fpVal) {
    const mv = num(r.master_value);
    const bv = num(r.bal_value);
    if (!near(mv, bv)) {
      fpValOk = false;
      failures.push(
        `FP null-BU value tenant=${r.tenant_id}: master(WAC)=${mv} bal=${bv} delta=${bv - mv}`,
      );
      console.error(
        `  DIFF FP value tenant=${r.tenant_id} master(WAC)=${mv} bal=${bv}`,
      );
    }
  }
  if (fpValOk)
    console.log("PASS: per-tenant FP null-BU value == master*WAC value");

  if (!fpValOk) {
    const { rows: itemDiffs } = await client.query<{
      tenant_id: string;
      product_id: string;
      master_value: string;
      bal_value: string;
    }>(
      `
      SELECT fp.tenant_id, fp.id AS product_id,
             (fp.current_stock * COALESCE(public.finished_product_weighted_avg_cost(fp.id), 0))::text AS master_value,
             (COALESCE(b.current_stock, 0) * COALESCE(b.average_cost_per_unit, 0))::text AS bal_value
      FROM finished_products fp
      LEFT JOIN finished_product_balances b
        ON b.product_id = fp.id AND b.tenant_id = fp.tenant_id
       AND b.business_unit_id IS NULL
      WHERE ABS(
        fp.current_stock * COALESCE(public.finished_product_weighted_avg_cost(fp.id), 0)
        - COALESCE(b.current_stock, 0) * COALESCE(b.average_cost_per_unit, 0)
      ) > $1
      ORDER BY fp.tenant_id, fp.id
      LIMIT 40
      `,
      [TOL],
    );
    for (const r of itemDiffs) {
      console.error(
        `  ITEM FP value ${r.product_id} tenant=${r.tenant_id} master=${r.master_value} bal=${r.bal_value}`,
      );
    }
  }
}

async function runModeB(client: pg.Client, failures: string[]) {
  const { rows: rm } = await client.query<{
    master_qty: string;
    bal_qty: string;
  }>(
    `
    SELECT
      (SELECT COALESCE(SUM(current_stock), 0) FROM raw_materials)::text AS master_qty,
      (SELECT COALESCE(SUM(current_stock), 0) FROM raw_material_balances)::text AS bal_qty
    `,
  );
  const rmMaster = num(rm[0]?.master_qty);
  const rmBal = num(rm[0]?.bal_qty);
  if (near(rmMaster, rmBal)) {
    console.log(
      `PASS: RM sum(all BU balances.qty)=${rmBal} == sum(master.qty)=${rmMaster}`,
    );
  } else {
    failures.push(
      `RM Mode B qty: master=${rmMaster} all_balances=${rmBal} delta=${rmBal - rmMaster}`,
    );
    console.error(
      `  DIFF RM Mode B master=${rmMaster} all_balances=${rmBal}`,
    );
  }

  const { rows: fp } = await client.query<{
    master_qty: string;
    bal_qty: string;
  }>(
    `
    SELECT
      (SELECT COALESCE(SUM(current_stock), 0) FROM finished_products)::text AS master_qty,
      (SELECT COALESCE(SUM(current_stock), 0) FROM finished_product_balances)::text AS bal_qty
    `,
  );
  const fpMaster = num(fp[0]?.master_qty);
  const fpBal = num(fp[0]?.bal_qty);
  if (near(fpMaster, fpBal)) {
    console.log(
      `PASS: FP sum(all BU balances.qty)=${fpBal} == sum(master.qty)=${fpMaster}`,
    );
  } else {
    failures.push(
      `FP Mode B qty: master=${fpMaster} all_balances=${fpBal} delta=${fpBal - fpMaster}`,
    );
    console.error(
      `  DIFF FP Mode B master=${fpMaster} all_balances=${fpBal}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runVerify264(args);
  if (!result.ok) process.exit(1);
}

const isMain =
  typeof process.argv[1] === "string" &&
  /verify-264-inventory-balance-invariant\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, "/"),
  );

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
