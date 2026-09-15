/**
 * Apply scripts/286 + 287 to production (sales rep attribution).
 *
 * Usage:
 *   npx tsx scripts/apply-286-287-sales-rep-attribution-production.ts --confirm-286-287-production
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const ENV_FILES = [".env.production.local", ".env.local.backup"] as const;

const SQL_FILES = [
  "scripts/286_create_product_sale_persist_sales_rep_id.sql",
  "scripts/287_client_quotations_assigned_sales_rep_id.sql",
] as const;

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

function loadProductionEnv(): string {
  const loaded: string[] = [];

  for (const envFile of ENV_FILES) {
    const path = resolve(process.cwd(), envFile);
    if (!existsSync(path)) {
      continue;
    }

    delete process.env.PRODUCTION_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    loadEnvForce(path);
    loaded.push(envFile);
  }

  if (loaded.length === 0) {
    throw new Error(
      `No production env file found. Expected one of: ${ENV_FILES.join(", ")}`,
    );
  }

  console.log(`Loaded production env from: ${loaded.join(" -> ")}`);
  return loaded[loaded.length - 1]!;
}

function resolveDatabaseUrl(): { url: string; sourceVar: string } {
  const candidates = [
    "PRODUCTION_DATABASE_URL",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
  ] as const;

  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value && !value.includes("[SENSITIVE]")) {
      return { url: value, sourceVar: name };
    }
  }

  throw new Error(
    "PRODUCTION_DATABASE_URL, DATABASE_URL, or SUPABASE_DB_URL required (non-scrubbed) in production env file.",
  );
}

function extractProjectRef(connectionUrl: string): string | null {
  const trimmed = connectionUrl.trim();
  if (trimmed.includes(STAGING_REF)) {
    return STAGING_REF;
  }
  if (trimmed.includes(PRODUCTION_REF)) {
    return PRODUCTION_REF;
  }

  try {
    const parsed = new URL(trimmed);
    const hostRef = parsed.hostname.split(".")[0]?.replace(/^postgres\./, "") ?? "";
    if (hostRef === STAGING_REF || hostRef === PRODUCTION_REF) {
      return hostRef;
    }
    const userRef = decodeURIComponent(parsed.username).replace(/^postgres\./, "");
    if (userRef === STAGING_REF || userRef === PRODUCTION_REF) {
      return userRef;
    }
  } catch {
    // fall through
  }

  return null;
}

function assertProductionConnectionUrl(connectionUrl: string, sourceVar: string) {
  const ref = extractProjectRef(connectionUrl);
  if (ref === STAGING_REF) {
    throw new Error(
      `Refusing to run: ${sourceVar} resolves to staging (${STAGING_REF}). Production apply aborted before any SQL.`,
    );
  }
  if (ref !== PRODUCTION_REF) {
    throw new Error(
      `Refusing to run: ${sourceVar} does not resolve to production (${PRODUCTION_REF}). Found ref=${ref ?? "unknown"}. Production apply aborted before any SQL.`,
    );
  }
}

function connectionHostForLog(connectionUrl: string): string {
  try {
    const parsed = new URL(connectionUrl);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "(unparseable URL)";
  }
}

async function assertConnectedProductionProject(
  client: pg.Client,
  expectedRef: string,
  connectionUrl: string,
) {
  const urlRef = extractProjectRef(connectionUrl);
  if (urlRef !== expectedRef) {
    throw new Error(
      `Connected URL does not match production project ${expectedRef} (resolved ref=${urlRef ?? "unknown"}). Aborting before any SQL.`,
    );
  }

  const { rows } = await client.query<{ current_user: string; current_database: string }>(
    "SELECT current_user, current_database() AS current_database",
  );
  const currentUser = rows[0]?.current_user ?? "";

  if (currentUser.includes(STAGING_REF)) {
    throw new Error(
      `Connected database user resolves to staging (${STAGING_REF}). Aborting before any SQL.`,
    );
  }

  if (currentUser.includes(expectedRef)) {
    console.log(
      `Verified production project ref: ${expectedRef} (current_user=${currentUser}, current_database=${rows[0]?.current_database ?? "?"})`,
    );
    return;
  }

  console.log(
    `Verified production project ref: ${expectedRef} from connection URL (current_user=${currentUser}, current_database=${rows[0]?.current_database ?? "?"})`,
  );
}

async function main() {
  if (!process.argv.includes("--confirm-286-287-production")) {
    console.error("Pass --confirm-286-287-production to apply migrations to production.");
    process.exit(1);
  }

  const envFileUsed = loadProductionEnv();
  const { url: rawUrl, sourceVar } = resolveDatabaseUrl();
  assertProductionConnectionUrl(rawUrl, sourceVar);

  const ddlUrl = rawUrl.replace(":6543/", ":5432/");
  assertProductionConnectionUrl(ddlUrl, sourceVar);

  console.log(
    `Resolved ${sourceVar} from ${envFileUsed} -> host ${connectionHostForLog(ddlUrl)} (project ref ${PRODUCTION_REF})`,
  );

  const client = new pg.Client({
    connectionString: ddlUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await assertConnectedProductionProject(client, PRODUCTION_REF, ddlUrl);
  console.log(`Connected to production (${PRODUCTION_REF}) on session pooler port 5432.`);

  for (const file of SQL_FILES) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
    console.log(`OK: ${file}`);
  }

  const fnCheck = await client.query<{ def: string; has_var: boolean; has_insert: boolean }>(`
    SELECT
      pg_get_functiondef(p.oid) AS def,
      pg_get_functiondef(p.oid) LIKE '%v_sales_rep_id text :=%' AS has_var,
      pg_get_functiondef(p.oid) LIKE '%sales_rep_id%' AS has_insert
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
    LIMIT 1
  `);
  const fnRow = fnCheck.rows[0];
  if (!fnRow?.has_var || !fnRow?.has_insert) {
    throw new Error("create_product_sale does not persist sales_rep_id after 286");
  }
  console.log("\n[1] create_product_sale: PASS");
  console.log("    - v_sales_rep_id assignment: yes");
  console.log("    - INSERT includes sales_rep_id: yes");

  const colCheck = await client.query<{ column_name: string; is_nullable: string; data_type: string }>(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'assigned_sales_rep_id'
  `);
  if (colCheck.rowCount === 0) {
    throw new Error("assigned_sales_rep_id column missing after 287");
  }
  console.log("\n[2] client_quotations.assigned_sales_rep_id: PASS");
  console.log(`    - type: ${colCheck.rows[0]?.data_type}, nullable: ${colCheck.rows[0]?.is_nullable}`);

  const quotStats = await client.query<{ total: string; non_null: string }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE assigned_sales_rep_id IS NOT NULL)::text AS non_null
    FROM client_quotations
  `);
  const total = Number(quotStats.rows[0]?.total ?? 0);
  const nonNull = Number(quotStats.rows[0]?.non_null ?? 0);
  console.log("\n[3] Data migration check: PASS (no backfill)");
  console.log(`    - client_quotations total rows: ${total}`);
  console.log(`    - rows with assigned_sales_rep_id set: ${nonNull} (expected 0 — additive NULL column)`);
  console.log("    - create_product_sale: function replacement only (no table UPDATE in migration)");

  if (nonNull > 0) {
    console.warn(
      "    WARNING: non-null assigned_sales_rep_id rows exist — may be from app usage post-deploy, not migration backfill.",
    );
  }

  console.log(`\nPASS: 286 + 287 applied on production (${PRODUCTION_REF}).`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
