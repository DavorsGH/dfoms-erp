import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

// Prefer backup (production), then local overrides for password helpers only.
loadEnvForce(resolve(process.cwd(), ".env.local"));
loadEnvForce(resolve(process.cwd(), ".env.local.backup"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Refusing to run: expected production project tvcurcnmasnocwdxzgvz");
}

const projectRef = "tvcurcnmasnocwdxzgvz";
const password =
  process.env.SUPABASE_DB_PASSWORD ||
  (() => {
    try {
      return decodeURIComponent(new URL(process.env.DATABASE_URL).password);
    } catch {
      return null;
    }
  })();

function candidates() {
  const out = [];
  const raw = process.env.DATABASE_URL;
  if (raw) {
    out.push(raw);
    try {
      const u = new URL(raw);
      u.password = encodeURIComponent(decodeURIComponent(u.password));
      out.push(u.toString());
    } catch {
      /* ignore */
    }
  }
  if (password) {
    const enc = encodeURIComponent(password);
    for (const region of ["eu-north-1", "eu-west-1", "eu-central-1"]) {
      out.push(
        `postgresql://postgres.${projectRef}:${enc}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
      );
      out.push(
        `postgresql://postgres.${projectRef}:${enc}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
      );
    }
    out.push(
      `postgresql://postgres:${enc}@db.${projectRef}.supabase.co:5432/postgres`,
    );
  }
  return [...new Set(out.filter(Boolean))];
}

const expectedTables = [
  "sms_credit_packs",
  "sms_credit_wallets",
  "sms_credit_transactions",
  "sms_credit_purchase_requests",
];
const expectedFuncs = [
  "ensure_sms_allowance_current",
  "debit_sms_credit",
  "credit_sms_purchase",
];
const expectedPolicies = [
  "sms_credit_wallets_tenant_select",
  "sms_credit_transactions_tenant_select",
  "sms_credit_purchase_requests_tenant_select",
  "sms_credit_purchase_requests_tenant_insert",
  "sms_credit_purchase_requests_tenant_update",
];

async function probeViaPg() {
  let lastError;
  for (const connectionString of candidates()) {
    const redacted = connectionString.replace(/:[^:@/]+@/, ":***@");
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      console.log("PG connected:", redacted);

      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema='public' AND table_name = ANY($1::text[])
         ORDER BY 1`,
        [expectedTables],
      );
      const rls = await client.query(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY($1::text[])
         ORDER BY 1`,
        [expectedTables],
      );
      const policies = await client.query(
        `SELECT tablename, policyname, cmd
         FROM pg_policies
         WHERE schemaname='public' AND tablename = ANY($1::text[])
         ORDER BY 1,2`,
        [expectedTables],
      );
      const funcs = await client.query(
        `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname = ANY($1::text[])
         ORDER BY 1`,
        [expectedFuncs],
      );
      const privs = await client.query(
        `SELECT p.proname, r.rolname AS grantee,
                has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN (
           SELECT oid, rolname FROM pg_roles
           WHERE rolname IN ('anon','authenticated','service_role')
         ) r
         WHERE n.nspname='public' AND p.proname = ANY($1::text[])
         ORDER BY 1,2`,
        [expectedFuncs],
      );
      const packs = await client.query(
        `SELECT pack_key, credits, price_ghs::text, is_active
         FROM sms_credit_packs ORDER BY credits`,
      );

      const presentTables = new Set(tables.rows.map((r) => r.table_name));
      const presentFuncs = new Set(funcs.rows.map((r) => r.proname));
      const presentPolicies = new Set(policies.rows.map((r) => r.policyname));

      console.log(
        JSON.stringify(
          {
            mode: "pg",
            tables: {
              present: expectedTables.filter((t) => presentTables.has(t)),
              missing: expectedTables.filter((t) => !presentTables.has(t)),
            },
            rls: rls.rows,
            policies: {
              present: expectedPolicies.filter((p) => presentPolicies.has(p)),
              missing: expectedPolicies.filter((p) => !presentPolicies.has(p)),
              all_found: policies.rows,
            },
            functions: {
              present: expectedFuncs.filter((f) => presentFuncs.has(f)),
              missing: expectedFuncs.filter((f) => !presentFuncs.has(f)),
              details: funcs.rows,
            },
            execute_privileges: privs.rows,
            packs: packs.rows,
          },
          null,
          2,
        ),
      );
      await client.end();
      return true;
    } catch (err) {
      lastError = err;
      console.log("PG fail:", redacted, err.message);
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  console.log("All PG candidates failed. Last:", lastError?.message);
  return false;
}

async function probeViaRest() {
  const service = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const anon = createClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );

  const tableChecks = [];
  for (const t of expectedTables) {
    const { error, count, status } = await service
      .from(t)
      .select("*", { count: "exact", head: true });
    tableChecks.push({
      table: t,
      present: !error || error.code !== "PGRST205",
      status,
      count,
      error: error ? { code: error.code, message: error.message } : null,
    });
  }

  const packs = await service
    .from("sms_credit_packs")
    .select("pack_key,credits,price_ghs,is_active")
    .order("credits");

  const funcChecks = [];
  for (const fn of expectedFuncs) {
    const args =
      fn === "credit_sms_purchase"
        ? {
            p_tenant_id: "00000000-0000-0000-0000-000000000000",
            p_credits: 0,
            p_reference: "probe-no-apply",
          }
        : { p_tenant_id: "00000000-0000-0000-0000-000000000000" };
    const asService = await service.rpc(fn, args);
    const asAnon = await anon.rpc(fn, args);
    funcChecks.push({
      function: fn,
      service: {
        ok: !asService.error || asService.error.code === "23503",
        error: asService.error
          ? { code: asService.error.code, message: asService.error.message }
          : null,
        data: asService.data,
      },
      anon: {
        denied:
          asAnon.error?.code === "42501" ||
          /permission denied/i.test(asAnon.error?.message ?? ""),
        error: asAnon.error
          ? { code: asAnon.error.code, message: asAnon.error.message }
          : null,
      },
    });
  }

  const rlsHints = [];
  for (const t of [
    "sms_credit_wallets",
    "sms_credit_transactions",
    "sms_credit_purchase_requests",
  ]) {
    const { count, error, status } = await anon
      .from(t)
      .select("*", { count: "exact", head: true });
    rlsHints.push({
      table: t,
      anon_count: count,
      status,
      note:
        count === 0
          ? "anon sees 0 rows (consistent with RLS + no tenant JWT)"
          : "anon sees rows — RLS may be missing/permissive",
      error: error ? { code: error.code, message: error.message } : null,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "rest_service_role",
        tables: tableChecks,
        packs: packs.data,
        packs_error: packs.error
          ? { code: packs.error.code, message: packs.error.message }
          : null,
        functions: funcChecks,
        rls_behavioral_hints: rlsHints,
        policy_names:
          "NOT directly queryable without DATABASE_URL / pg_catalog access",
      },
      null,
      2,
    ),
  );
}

const pgOk = await probeViaPg();
if (!pgOk) await probeViaRest();
