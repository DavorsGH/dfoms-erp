import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.local.backup"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Refusing to run: expected production project tvcurcnmasnocwdxzgvz");
}

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

const candidates = [];
const rawUrl = process.env.DATABASE_URL;
if (rawUrl) {
  candidates.push(rawUrl, rebuildUrl(rawUrl));
}
if (process.env.SUPABASE_DB_PASSWORD && supabaseUrl) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const password = process.env.SUPABASE_DB_PASSWORD;
  candidates.push(
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
  );
}

const sqlPath =
  process.argv[2] ??
  resolve(process.cwd(), "../../06 Database/87_drop_old_create_product_purchase_overload.sql");

const verifySql = `
  SELECT
    p.oid::regprocedure AS signature,
    pg_get_function_arguments(p.oid) AS args,
    pg_get_function_result(p.oid) AS result_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'create_product_purchase'
    AND n.nspname = 'public'
  ORDER BY pg_get_function_arguments(p.oid);
`;

const { default: pg } = await import("pg");
let lastError;

for (const connectionString of [...new Set(candidates.filter(Boolean))]) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log("Target: PRODUCTION (tvcurcnmasnocwdxzgvz)\n");

    console.log("=== BEFORE ===");
    const before = await client.query(verifySql);
    console.table(before.rows);

    const sql = readFileSync(sqlPath, "utf8");
    console.log("\nRunning 87_drop_old_create_product_purchase_overload.sql...");
    await client.query(sql);
    console.log("SUCCESS: script applied.\n");

    console.log("=== AFTER ===");
    const after = await client.query(verifySql);
    console.table(after.rows);

    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

throw lastError ?? new Error("No database connection candidate worked");
