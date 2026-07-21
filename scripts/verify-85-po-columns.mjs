import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = process.argv[2] ?? ".env.staging.local";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), envFile));

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
if (process.env.SUPABASE_DB_PASSWORD && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const password = process.env.SUPABASE_DB_PASSWORD;
  candidates.push(
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  );
}

const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]
  : "(unknown)";
console.log(`Env file: ${envFile}`);
console.log(`Target project ref: ${projectRef}\n`);

const columnsSql = `
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'raw_material_purchases'
    AND column_name IN ('po_id', 'po_item_id')
  ORDER BY column_name;
`;

const triggerSql = `
  SELECT trigger_name FROM information_schema.triggers
  WHERE event_object_table = 'raw_material_purchases'
    AND trigger_name = 'trg_raw_material_purchases_apply_to_po';
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

    const columnsResult = await client.query(columnsSql);
    const triggerResult = await client.query(triggerSql);

    await client.end();

    console.log("=== raw_material_purchases columns (po_id, po_item_id) ===");
    console.table(columnsResult.rows);
    console.log(
      "=== trigger (trg_raw_material_purchases_apply_to_po) ===",
    );
    console.table(triggerResult.rows);

    const columnNames = columnsResult.rows.map((row) => row.column_name);
    const hasPoId = columnNames.includes("po_id");
    const hasPoItemId = columnNames.includes("po_item_id");
    const hasTrigger = triggerResult.rows.length > 0;

    console.log("\n=== summary ===");
    console.log(`po_id present:      ${hasPoId ? "YES" : "NO"}`);
    console.log(`po_item_id present: ${hasPoItemId ? "YES" : "NO"}`);
    console.log(`trigger present:    ${hasTrigger ? "YES" : "NO"}`);
    console.log(
      hasPoId && hasPoItemId && hasTrigger
        ? "\nRESULT: CONFIRMED — script 85 is applied on this environment."
        : "\nRESULT: NOT FULLY APPLIED — one or more objects are missing.",
    );

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
