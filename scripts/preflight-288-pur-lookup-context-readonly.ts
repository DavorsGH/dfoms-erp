/**
 * Read-only pre-flight: verify _pur_lookup_purchase_source_context on staging + production.
 * npx tsx scripts/preflight-288-pur-lookup-context-readonly.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const ENVS = [
  {
    label: "staging",
    ref: "wieflwbfdmjtsdnwbfii",
    envFile: ".env.staging.local",
  },
  {
    label: "production",
    ref: "tvcurcnmasnocwdxzgvz",
    envFile: ".env.local.backup",
  },
];

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function probeEnv(cfg: (typeof ENVS)[number]) {
  loadEnv(resolve(cfg.envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(cfg.ref)) {
    throw new Error(`${cfg.label}: env file does not match ref ${cfg.ref}`);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const exists = await client.query(
      `
        SELECT
          p.oid::regprocedure AS signature,
          pg_get_function_identity_arguments(p.oid) AS identity_args,
          pg_get_function_result(p.oid) AS result_type,
          p.prosecdef AS security_definer
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = '_pur_lookup_purchase_source_context'
        ORDER BY identity_args
      `,
    );

    const def = await client.query(
      `
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = '_pur_lookup_purchase_source_context'
          AND pg_get_function_identity_arguments(p.oid) = 'p_source_type text, p_source_id text'
        LIMIT 1
      `,
    );

    const attrs = await client.query(
      `
        SELECT
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(coalesce(p.proallargtypes, p.proargtypes)) WITH ORDINALITY AS u(type_oid, ord)
        JOIN pg_attribute a
          ON a.attrelid = u.type_oid
         AND a.attnum > 0
         AND NOT a.attisdropped
        WHERE n.nspname = 'public'
          AND p.proname = '_pur_lookup_purchase_source_context'
          AND pg_get_function_identity_arguments(p.oid) = 'p_source_type text, p_source_id text'
        ORDER BY a.attnum
      `,
    );

    return {
      label: cfg.label,
      ref: cfg.ref,
      overload_count: exists.rows.length,
      overloads: exists.rows,
      definition: def.rows[0]?.definition ?? null,
      composite_columns: attrs.rows,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const results = [];
  for (const cfg of ENVS) {
    results.push(await probeEnv(cfg));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
