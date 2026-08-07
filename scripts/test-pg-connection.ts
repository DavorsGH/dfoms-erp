/**
 * Test Postgres connectivity for each env file / candidate URL (no secrets printed).
 *
 * Usage:
 *   npx tsx scripts/test-pg-connection.ts
 *   npx tsx scripts/test-pg-connection.ts --env-file .env.local.backup
 */
import pg from "pg";
import { resolve } from "node:path";
import { buildPgConnectionCandidates } from "./lib/pg-connect";
import { loadEnvForce } from "./lib/env";

function parseArgs(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  return {
    envFiles:
      idx >= 0 && argv[idx + 1]
        ? [argv[idx + 1]]
        : [".env.staging.local", ".env.local.backup"],
  };
}

async function tryConnect(label: string, connectionString: string) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  try {
    await client.connect();
    const { rows } = (await client.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'",
    )) as unknown as { rows: { n: number }[] };
    await client.end();
    return { ok: true as const, detail: `${rows[0]?.n ?? 0} public policies` };
  } catch (error) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, detail: message.split("\n")[0] };
  }
}

async function main() {
  const { envFiles } = parseArgs(process.argv.slice(2));

  for (const envFile of envFiles) {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_DB_PASSWORD;
    delete process.env.DB_PASSWORD;

    loadEnvForce(resolve(process.cwd(), envFile));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : "?";
    const candidates = buildPgConnectionCandidates(
      process.env.DATABASE_URL,
      supabaseUrl,
    );

    console.log(`\n=== ${envFile} (ref ${ref}) ===`);
    console.log(`Candidates: ${candidates.length}`);

    let anyOk = false;
    for (const [index, connectionString] of candidates.entries()) {
      const host = (() => {
        try {
          return new URL(connectionString).host;
        } catch {
          return "?";
        }
      })();
      const result = await tryConnect(`${envFile}#${index}`, connectionString);
      console.log(
        `[${index}] ${host} → ${result.ok ? "OK" : "FAIL"} — ${result.detail}`,
      );
      if (result.ok) anyOk = true;
    }

    if (!anyOk) {
      console.log("No candidate connected. Update DATABASE_URL password from Supabase Dashboard.");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
