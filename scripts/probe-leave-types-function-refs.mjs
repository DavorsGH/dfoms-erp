import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

try {
  loadEnvFile(resolve(process.cwd(), ".env.staging.local"));
} catch {
  /* optional */
}
loadEnvFile(resolve(process.cwd(), ".env.local"));

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const r = await client.query(`
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.prosecdef AS security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc ILIKE '%leave_types%'
    ORDER BY p.proname, args
  `);

  for (const row of r.rows) {
    const def = await client.query(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
         AND pg_get_function_identity_arguments(p.oid) = $2
       LIMIT 1`,
      [row.proname, row.args],
    );
    const src = def.rows[0]?.def ?? "";
    const hasTenantFilter =
      /lt\.tenant_id|leave_types\.tenant_id|tenant_id = v_tenant|tenant_id = p_tenant|tenant_id = v_employee\.tenant_id|tenant_id = v_tenant_id/i.test(
        src,
      );
    const byTypeNameOnly =
      /type_name\s*=\s*ANY|WHERE\s+lt\.type_name|FROM leave_types lt\s*\n\s*WHERE(?!.*tenant)/is.test(
        src,
      );
    console.log("---");
    console.log(row.proname, `(${row.args})`, row.security_definer ? "SD" : "SI");
    console.log("tenant_filter_in_leave_types_query:", hasTenantFilter);
    console.log("by_type_name_pattern:", byTypeNameOnly);
  }

  const pol = await client.query(`
    SELECT polname, pg_get_expr(polqual, polrelid) AS qual
    FROM pg_policy
    JOIN pg_class c ON c.oid = polrelid
    WHERE c.relname = 'leave_types'
  `);
  console.log("\nRLS policies on leave_types:", JSON.stringify(pol.rows, null, 2));

  const impl = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'approve_leave_request__impl'
    LIMIT 1
  `);
  console.log("\napprove_leave_request__impl:\n", impl.rows[0]?.def ?? "NOT FOUND");
} finally {
  await client.end();
}
