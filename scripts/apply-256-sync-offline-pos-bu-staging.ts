/**
 * Apply scripts/256_sync_offline_pos_cash_sale_business_unit.sql to staging.
 * Probes live signatures first (same caution as 255).
 *
 * Usage: npx tsx scripts/apply-256-sync-offline-pos-bu-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

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

async function listOverloads(client: pg.Client, names: string[]) {
  const { rows } = await client.query(
    `
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname, p.oid
    `,
    [names],
  );
  return rows as Array<{ proname: string; args: string }>;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Expected staging project ${STAGING_PROJECT_REF}`);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not configured for staging");
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await listOverloads(client, [
      "sync_offline_pos_cash_sale",
      "resolve_offline_sale_conflict",
    ]);
    console.log("--- before ---");
    for (const row of before) {
      console.log(`${row.proname}(${row.args})`);
    }

    const syncBefore = before.filter((r) => r.proname === "sync_offline_pos_cash_sale");
    if (syncBefore.length === 0) {
      throw new Error("sync_offline_pos_cash_sale not found on staging");
    }
    const unexpected = syncBefore.filter(
      (r) =>
        r.args !== "p_client_op_id uuid, p_payload jsonb" &&
        !r.args.includes("p_business_unit_id"),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Unexpected sync_offline_pos_cash_sale signature(s): ${unexpected
          .map((r) => r.args)
          .join(" | ")}`,
      );
    }

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/256_sync_offline_pos_cash_sale_business_unit.sql"),
      "utf8",
    );
    console.log("Applying 256_sync_offline_pos_cash_sale_business_unit.sql …");
    await client.query(sql);

    const after = await listOverloads(client, [
      "sync_offline_pos_cash_sale",
      "resolve_offline_sale_conflict",
    ]);
    console.log("--- after ---");
    for (const row of after) {
      console.log(`${row.proname}(${row.args})`);
    }

    const syncAfter = after.filter((r) => r.proname === "sync_offline_pos_cash_sale");
    if (syncAfter.length !== 1) {
      throw new Error(
        `Expected exactly 1 sync_offline_pos_cash_sale overload, got ${syncAfter.length}`,
      );
    }
    if (!syncAfter[0].args.includes("p_business_unit_id")) {
      throw new Error("sync_offline_pos_cash_sale missing p_business_unit_id");
    }

    const { rows: defRows } = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'resolve_offline_sale_conflict'
      ORDER BY p.oid DESC
      LIMIT 1
    `);
    const resolveDef = String(defRows[0]?.def ?? "");
    if (!resolveDef.includes("v_business_unit_id")) {
      throw new Error("resolve_offline_sale_conflict body missing v_business_unit_id");
    }
    if (!resolveDef.includes("business_unit_id")) {
      throw new Error("resolve_offline_sale_conflict body missing claim business_unit_id");
    }

    console.log("PASS: 256 applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
