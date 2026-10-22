import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

const envFile = process.argv[2] ?? ".env.staging.local";
for (const line of readFileSync(resolve(envFile), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i === -1) continue;
  process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
}

const names = process.argv.slice(3);
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
for (const name of names) {
  const { rows } = await client.query(
    `SELECT tablename, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND policyname = $1`,
    [name],
  );
  console.log(JSON.stringify(rows[0] ?? null, null, 2));
}
await client.end();
