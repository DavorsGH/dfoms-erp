/**
 * Apply scripts/145_finished_product_on_hand_wac.sql to staging only.
 * Usage: npx tsx scripts/apply-145-on-hand-wac-staging.ts
 *
 * If DATABASE_URL password auth fails, run the SQL in the Supabase SQL Editor
 * on staging project wieflwbfdmjtsdnwbfii instead.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

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

type ConnCandidate = {
  label: string;
  config: ConstructorParameters<typeof pg.Client>[0];
};

function buildCandidates(
  rawUrl: string | undefined,
  supabaseUrl: string,
  dbPassword: string | undefined,
): ConnCandidate[] {
  const candidates: ConnCandidate[] = [];
  const ref = (() => {
    try {
      return new URL(supabaseUrl).hostname.split(".")[0] ?? "";
    } catch {
      return "";
    }
  })();

  const pushExplicit = (
    label: string,
    user: string,
    password: string,
    host: string,
    port: number,
  ) => {
    candidates.push({
      label,
      config: {
        user,
        password,
        host,
        port,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 12000,
      },
    });
  };

  if (rawUrl) {
    candidates.push({
      label: "DATABASE_URL raw",
      config: {
        connectionString: rawUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 12000,
      },
    });
    try {
      const parsed = new URL(rawUrl);
      const password = decodeURIComponent(parsed.password);
      const user = decodeURIComponent(parsed.username);
      // Explicit fields avoid URL special-character misparse.
      pushExplicit(
        `DATABASE_URL explicit ${parsed.hostname}:${parsed.port || "5432"}`,
        user,
        password,
        parsed.hostname,
        Number(parsed.port || 5432),
      );
      if (ref) {
        for (const region of ["eu-west-1", "eu-north-1"]) {
          pushExplicit(
            `pooler session ${region}`,
            `postgres.${ref}`,
            password,
            `aws-0-${region}.pooler.supabase.com`,
            5432,
          );
          pushExplicit(
            `pooler transaction ${region}`,
            `postgres.${ref}`,
            password,
            `aws-0-${region}.pooler.supabase.com`,
            6543,
          );
        }
        pushExplicit(
          "direct db host",
          "postgres",
          password,
          `db.${ref}.supabase.co`,
          5432,
        );
      }
    } catch {
      // ignore malformed URL
    }
  }

  if (dbPassword && ref) {
    for (const region of ["eu-west-1", "eu-north-1"]) {
      pushExplicit(
        `SUPABASE_DB_PASSWORD pooler ${region}`,
        `postgres.${ref}`,
        dbPassword,
        `aws-0-${region}.pooler.supabase.com`,
        5432,
      );
    }
    pushExplicit(
      "SUPABASE_DB_PASSWORD direct",
      "postgres",
      dbPassword,
      `db.${ref}.supabase.co`,
      5432,
    );
  }

  return candidates;
}

async function connectWithCandidates(
  label: string,
  candidates: ConnCandidate[],
): Promise<{ client: pg.Client; index: number } | null> {
  for (const [index, candidate] of candidates.entries()) {
    const attempt = new pg.Client(candidate.config);
    try {
      await attempt.connect();
      console.log(`Connected via ${label} / ${candidate.label} (#${index})`);
      return { client: attempt, index };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${label} / ${candidate.label} (#${index}) failed: ${msg}`);
      try {
        await attempt.end();
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function main() {
  const envFiles = [".env.staging.local", ".env.local"];
  const sqlPath = resolve(
    process.cwd(),
    "scripts/145_finished_product_on_hand_wac.sql",
  );
  const sql = readFileSync(sqlPath, "utf8");

  let client: pg.Client | null = null;
  for (const envFile of envFiles) {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      console.warn(`Skipping missing ${envFile}`);
      continue;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    let ref = "";
    try {
      ref = new URL(supabaseUrl).hostname.split(".")[0] ?? "";
    } catch {
      // ignore
    }
    if (ref !== STAGING_REF) {
      console.warn(`Skipping ${envFile}: not staging project (got ${ref || "none"})`);
      continue;
    }
    const candidates = buildCandidates(
      process.env.DATABASE_URL,
      supabaseUrl,
      process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD,
    );
    if (candidates.length === 0) {
      console.warn(`Skipping ${envFile}: no DATABASE_URL / DB password`);
      continue;
    }
    const connected = await connectWithCandidates(envFile, candidates);
    if (connected) {
      client = connected.client;
      break;
    }
  }

  if (!client) {
    throw new Error(
      "Could not connect to staging DB. Apply scripts/145_finished_product_on_hand_wac.sql (or 06 Database/145_finished_product_on_hand_wac.sql) in the Supabase SQL Editor on wieflwbfdmjtsdnwbfii, then re-run verify.",
    );
  }

  try {
    await client.query(sql);
    console.log("Applied script 145 on staging");

    const { rows: wacRows } = await client.query(`
      SELECT pg_get_functiondef('public.finished_product_weighted_avg_cost(uuid)'::regprocedure) AS def
    `);
    const wacDef = wacRows[0]?.def ?? "";
    const hasOnHand =
      wacDef.includes("cogs_expense_id") &&
      wacDef.includes("current_stock") &&
      wacDef.includes("product_purchases");
    console.log("WAC uses on-hand formula:", hasOnHand);
    if (!hasOnHand) throw new Error("finished_product_weighted_avg_cost missing on-hand formula");

    const { rows: saleRows } = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
      ORDER BY p.oid
    `);
    const saleOk = saleRows.some((r) =>
      String(r.def).includes("finished_product_weighted_avg_cost"),
    );
    console.log("create_product_sale uses shared WAC:", saleOk);
    if (!saleOk) throw new Error("create_product_sale not pointing at shared WAC");

    console.log("PASS script 145 applied and functions verified");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
