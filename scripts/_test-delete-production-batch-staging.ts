/**
 * Staging tests for script 237 delete_production_batch.
 *
 *   npx tsx scripts/_test-delete-production-batch-staging.ts
 *
 * (a) delete fresh batch → materials restored, product stock down, movements gone
 * (b) sell most stock → delete blocked with clear message
 * (c) inventory valuation conserved across delete (raw + finished WAC)
 * (d) tenant isolation
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, eq).trim()] = v;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function close(a: number, b: number, tol = 0.05) {
  return Math.abs(a - b) <= tol;
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(databaseUrl, "DATABASE_URL required");
  assert(
    supabaseUrl.includes(STAGING_REF) || databaseUrl.includes(STAGING_REF),
    `Expected staging ${STAGING_REF}`,
  );

  const sql = readFileSync(
    resolve("scripts/237_delete_production_batch.sql"),
    "utf8",
  );
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();

  const stamp = Date.now().toString(36);
  const ids = {
    materialA: crypto.randomUUID(),
    productA: crypto.randomUUID(),
    purchaseA: crypto.randomUUID(),
    materialB: crypto.randomUUID(),
    productB: crypto.randomUUID(),
    batchB: null as string | null,
  };

  try {
    await db.query(sql);
    console.log("Applied 237_delete_production_batch.sql");

    const tenants = await db.query(
      `SELECT id FROM tenants ORDER BY created_at NULLS LAST, id LIMIT 2`,
    );
    assert(tenants.rows.length >= 2, "Need >=2 tenants");
    const tenantA = tenants.rows[0].id as string;
    const tenantB = tenants.rows[1].id as string;

    // Auth user for tenant A (for current_user_tenant_id)
    const ua = await db.query(
      `
      SELECT auth_uid
      FROM user_accounts
      WHERE tenant_id = $1 AND COALESCE(is_active, true) = true
      LIMIT 1
      `,
      [tenantA],
    );
    assert(ua.rows[0]?.auth_uid, "Need an active user_accounts row for tenant A");
    const authUid = ua.rows[0].auth_uid as string;
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
      authUid,
    ]);
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);

    const resolvedTenant = await db.query(
      `SELECT current_user_tenant_id() AS tid`,
    );
    console.log("current_user_tenant_id()", resolvedTenant.rows[0]?.tid);
    assert(
      resolvedTenant.rows[0]?.tid === tenantA,
      "JWT claim did not resolve to tenant A",
    );

    // Seed material + purchase + product
    await db.query(
      `
      INSERT INTO raw_materials (
        id, tenant_id, material_code, material_name, unit_of_measure,
        current_stock, average_cost_per_unit
      ) VALUES ($1, $2, $3, $4, 'kg', 0, 0)
      `,
      [ids.materialA, tenantA, `RM-D-${stamp}`, `Raw Del ${stamp}`],
    );
    await db.query(
      `
      INSERT INTO raw_material_purchases (
        id, tenant_id, material_id, purchase_date, quantity, cost_per_unit,
        total_cost, supplier, payment_method
      ) VALUES ($1, $2, $3, '2026-08-01', 100, 10, 1000, 'Supp', 'Cash')
      `,
      [ids.purchaseA, tenantA, ids.materialA],
    );
    await db.query(`SELECT recalculate_raw_material_inventory($1)`, [
      ids.materialA,
    ]);

    await db.query(
      `
      INSERT INTO finished_products (
        id, tenant_id, product_code, product_name, unit_of_measure,
        current_stock, standard_selling_price, sourcing_type
      ) VALUES ($1, $2, $3, $4, 'pcs', 0, 40, 'manufactured')
      `,
      [ids.productA, tenantA, `FP-D-${stamp}`, `Fin Del ${stamp}`],
    );

    async function createBatch(qty: number, materialQty: number, label: string) {
      const mat = await db.query(
        `SELECT average_cost_per_unit FROM raw_materials WHERE id = $1`,
        [ids.materialA],
      );
      const unitCost = Number(mat.rows[0].average_cost_per_unit);
      const total = Number((materialQty * unitCost).toFixed(4));
      const cpu = Number((total / qty).toFixed(4));
      const ins = await db.query(
        `
        INSERT INTO production_batches (
          batch_number, production_date, finished_product_id, quantity_produced,
          cost_per_unit_produced, total_batch_cost, notes, tenant_id
        ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [`B-${label}-${stamp}`, ids.productA, qty, cpu, total, label, tenantA],
      );
      const batchId = ins.rows[0].id as string;
      await db.query(
        `
        INSERT INTO production_batch_materials (
          batch_id, material_id, quantity_used, cost_at_time, tenant_id
        ) VALUES ($1, $2, $3, $4, $5)
        `,
        [batchId, ids.materialA, materialQty, unitCost, tenantA],
      );
      await db.query(
        `UPDATE raw_materials SET current_stock = current_stock - $2 WHERE id = $1`,
        [ids.materialA, materialQty],
      );
      await db.query(
        `UPDATE finished_products SET current_stock = current_stock + $2 WHERE id = $1`,
        [ids.productA, qty],
      );
      await db.query(
        `
        INSERT INTO stock_movements (
          product_id, movement_type, quantity, reference_id, movement_date, notes, tenant_id
        ) VALUES ($1, 'production_in', $2, $3, CURRENT_DATE, $4, $5)
        `,
        [ids.productA, qty, batchId, label, tenantA],
      );
      return batchId;
    }

    // (a)
    const batchA = await createBatch(20, 30, "a");
    const beforeA = await db.query(
      `
      SELECT
        (SELECT current_stock FROM raw_materials WHERE id = $1) AS mat,
        (SELECT average_cost_per_unit FROM raw_materials WHERE id = $1) AS avg,
        (SELECT current_stock FROM finished_products WHERE id = $2) AS prod
      `,
      [ids.materialA, ids.productA],
    );
    assert(Number(beforeA.rows[0].mat) === 70, "a setup material");
    assert(Number(beforeA.rows[0].prod) === 20, "a setup product");

    await db.query(`SELECT delete_production_batch($1)`, [batchA]);

    const afterA = await db.query(
      `
      SELECT
        (SELECT current_stock FROM raw_materials WHERE id = $1) AS mat,
        (SELECT average_cost_per_unit FROM raw_materials WHERE id = $1) AS avg,
        (SELECT current_stock FROM finished_products WHERE id = $2) AS prod,
        (SELECT COUNT(*)::int FROM production_batches WHERE id = $3) AS batches,
        (SELECT COUNT(*)::int FROM stock_movements WHERE reference_id = $3) AS moves,
        (SELECT COUNT(*)::int FROM production_batch_materials WHERE batch_id = $3) AS lines
      `,
      [ids.materialA, ids.productA, batchA],
    );
    assert(Number(afterA.rows[0].mat) === 100, "(a) material restored");
    assert(close(Number(afterA.rows[0].avg), 10), "(a) material avg");
    assert(Number(afterA.rows[0].prod) === 0, "(a) product stock 0");
    assert(afterA.rows[0].batches === 0, "(a) batch deleted");
    assert(afterA.rows[0].moves === 0, "(a) movements deleted");
    assert(afterA.rows[0].lines === 0, "(a) material lines deleted");
    console.log("PASS (a) fresh delete restores inventory");

    // (b)
    const batchB = await createBatch(20, 30, "b");
    await db.query(
      `UPDATE finished_products SET current_stock = 5 WHERE id = $1`,
      [ids.productA],
    );
    const preview = await db.query(
      `SELECT * FROM preview_delete_production_batch($1)`,
      [batchB],
    );
    assert(preview.rows[0].can_delete === false, "(b) preview blocked");
    assert(
      String(preview.rows[0].block_reason).toLowerCase().includes("cannot delete"),
      "(b) preview message",
    );
    let blocked = false;
    try {
      await db.query(`SELECT delete_production_batch($1)`, [batchB]);
    } catch (e) {
      blocked = true;
      const msg = e instanceof Error ? e.message : String(e);
      assert(msg.toLowerCase().includes("cannot delete"), `(b) ${msg}`);
    }
    assert(blocked, "(b) delete raised");
    // restore enough stock and delete for cleanup
    await db.query(
      `UPDATE finished_products SET current_stock = 20 WHERE id = $1`,
      [ids.productA],
    );
    await db.query(`SELECT delete_production_batch($1)`, [batchB]);
    console.log("PASS (b) blocked when stock insufficient");

    // (c)
    const batchC = await createBatch(10, 15, "c");
    const invSql = `
      SELECT
        COALESCE((
          SELECT SUM(current_stock * average_cost_per_unit)
          FROM raw_materials WHERE tenant_id = $1
        ), 0)
        + COALESCE((
          SELECT SUM(fp.current_stock * public.finished_product_weighted_avg_cost(fp.id))
          FROM finished_products fp WHERE fp.tenant_id = $1
        ), 0) AS inv
    `;
    const beforeInv = await db.query(invSql, [tenantA]);
    await db.query(`SELECT delete_production_batch($1)`, [batchC]);
    const afterInv = await db.query(invSql, [tenantA]);
    assert(
      close(Number(beforeInv.rows[0].inv), Number(afterInv.rows[0].inv)),
      `(c) inv before=${beforeInv.rows[0].inv} after=${afterInv.rows[0].inv}`,
    );
    console.log("PASS (c) inventory valuation conserved", {
      before: Number(beforeInv.rows[0].inv),
      after: Number(afterInv.rows[0].inv),
    });

    // (d) seed tenant B without session tenant (enforce_row_tenant_id)
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
    await db.query(
      `
      INSERT INTO raw_materials (
        id, tenant_id, material_code, material_name, unit_of_measure,
        current_stock, average_cost_per_unit
      ) VALUES ($1, $2, $3, $4, 'kg', 20, 5)
      `,
      [ids.materialB, tenantB, `RM-B-${stamp}`, `Raw B ${stamp}`],
    );
    await db.query(
      `
      INSERT INTO finished_products (
        id, tenant_id, product_code, product_name, unit_of_measure,
        current_stock, standard_selling_price, sourcing_type
      ) VALUES ($1, $2, $3, $4, 'pcs', 5, 20, 'manufactured')
      `,
      [ids.productB, tenantB, `FP-B-${stamp}`, `Fin B ${stamp}`],
    );
    const bIns = await db.query(
      `
      INSERT INTO production_batches (
        batch_number, production_date, finished_product_id, quantity_produced,
        cost_per_unit_produced, total_batch_cost, notes, tenant_id
      ) VALUES ($1, CURRENT_DATE, $2, 5, 5, 25, 'tenant-b', $3)
      RETURNING id
      `,
      [`B-TENANTB-${stamp}`, ids.productB, tenantB],
    );
    ids.batchB = bIns.rows[0].id as string;

    // Restore tenant A session for isolation check
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
      authUid,
    ]);
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);

    let isolated = false;
    try {
      await db.query(`SELECT delete_production_batch($1)`, [ids.batchB]);
    } catch {
      isolated = true;
    }
    const still = await db.query(
      `SELECT COUNT(*)::int AS c FROM production_batches WHERE id = $1`,
      [ids.batchB],
    );
    assert(still.rows[0].c === 1, "(d) batch B remains");
    assert(isolated, "(d) delete as tenant A failed");
    console.log("PASS (d) tenant isolation");

    console.log("\nALL PASS a–d");
  } finally {
    // cleanup best-effort
    try {
      if (ids.batchB) {
        await db.query(`DELETE FROM production_batches WHERE id = $1`, [
          ids.batchB,
        ]);
      }
      await db.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::uuid[])`, [
        [ids.productA, ids.productB],
      ]);
      await db.query(`DELETE FROM production_batch_materials WHERE material_id = ANY($1::uuid[])`, [
        [ids.materialA, ids.materialB],
      ]);
      await db.query(`DELETE FROM production_batches WHERE finished_product_id = ANY($1::uuid[])`, [
        [ids.productA, ids.productB],
      ]);
      await db.query(`DELETE FROM raw_material_purchases WHERE id = $1`, [
        ids.purchaseA,
      ]);
      await db.query(`DELETE FROM finished_products WHERE id = ANY($1::uuid[])`, [
        [ids.productA, ids.productB],
      ]);
      await db.query(`DELETE FROM raw_materials WHERE id = ANY($1::uuid[])`, [
        [ids.materialA, ids.materialB],
      ]);
    } catch (cleanupErr) {
      console.warn("cleanup warning", cleanupErr);
    }
    await db.end();
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
