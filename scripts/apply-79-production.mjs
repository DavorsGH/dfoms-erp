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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Refusing to run: expected production project tvcurcnmasnocwdxzgvz");
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/79_client_invoicing (1).sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
client.on("notice", (msg) => console.log("NOTICE:", msg.message));
await client.connect();

try {
  console.log(
    "Running 79_client_invoicing (1).sql on PRODUCTION (tvcurcnmasnocwdxzgvz)...",
  );
  await client.query(sql);
  console.log("SUCCESS: transaction committed with no errors.");
} finally {
  await client.end();
}
