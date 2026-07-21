import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

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

if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Refusing to run: expected production project tvcurcnmasnocwdxzgvz");
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const sqlPath =
  process.argv[2] ??
  resolve(process.cwd(), "../../06 Database/production_post_migration_sanity_check.sql");

const raw = readFileSync(sqlPath, "utf8");
const statements = raw
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("--"));

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  console.log("=== Production post-migration sanity check (tvcurcnmasnocwdxzgvz) ===\n");

  for (const statement of statements) {
    const label = statement
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("--"))
      ?.trim()
      .slice(0, 80);

    const result = await client.query(statement);
    console.log(`--- ${label}...`);
    console.log(`rows: ${result.rowCount}`);
    if (result.rows.length > 0) {
      console.log(JSON.stringify(result.rows, null, 2));
    }
    console.log("");
  }
} finally {
  await client.end();
}
