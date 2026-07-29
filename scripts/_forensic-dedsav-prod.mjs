import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

function loadEnv(filePath) {
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

loadEnv(resolve(".env.local.backup"));
const PROD = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const JULY_ID = "b60b70db-1179-4226-b86f-bbaefeed1fc5";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(PROD)) throw new Error(`Not production: ${url}`);

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function buildDbCandidates(projectRef) {
  const candidates = [];
  const explicit =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;
  if (explicit) candidates.push(explicit);
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password) {
    const encoded = encodeURIComponent(password);
    candidates.push(
      `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`,
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

console.log("=== 1. July DEDSAV lookups (service role) ===");

const byId = await admin
  .from("income_register")
  .select("*")
  .eq("id", JULY_ID);
console.log("by id (no tenant filter):", {
  error: byId.error?.message,
  count: byId.data?.length,
  rows: byId.data,
});

const byInvoiceAnyTenant = await admin
  .from("income_register")
  .select("*")
  .eq("invoice_no", "PAYROLL-DEDSAV-2026-07");
console.log("by invoice_no any tenant:", {
  error: byInvoiceAnyTenant.error?.message,
  count: byInvoiceAnyTenant.data?.length,
  rows: byInvoiceAnyTenant.data,
});

const byInvoiceDavors = await admin
  .from("income_register")
  .select("*")
  .eq("tenant_id", TENANT)
  .eq("invoice_no", "PAYROLL-DEDSAV-2026-07");
console.log("by invoice + Davors tenant:", {
  error: byInvoiceDavors.error?.message,
  count: byInvoiceDavors.data?.length,
  rows: byInvoiceDavors.data,
});

const likeDesc = await admin
  .from("income_register")
  .select("id, tenant_id, invoice_no, description, amount, date")
  .ilike("description", "%Auto-posted from Payroll July 2026%");
console.log("description ilike Auto-posted July:", likeDesc.data, likeDesc.error?.message);

const likeDedsav = await admin
  .from("income_register")
  .select("id, tenant_id, invoice_no, description, amount, date, outstanding_balance")
  .ilike("invoice_no", "%DEDSAV%");
console.log("all DEDSAV invoices any tenant:", likeDedsav.data, likeDedsav.error?.message);

console.log("\n=== 4. Exact June DEDSAV row (all columns) ===");
const june = await admin
  .from("income_register")
  .select("*")
  .eq("invoice_no", "PAYROLL-DEDSAV-2026-06");
console.log(JSON.stringify(june.data, null, 2));
console.log("error", june.error?.message);

console.log("\n=== month_end_close July/June ===");
const close = await admin
  .from("month_end_close")
  .select("*")
  .eq("tenant_id", TENANT)
  .in("month", ["2026-06-01", "2026-07-01"]);
console.log(JSON.stringify(close.data, null, 2));

console.log("\n=== PAYROLL-SAL June/July ===");
const sal = await admin
  .from("expense_register")
  .select("*")
  .eq("tenant_id", TENANT)
  .in("receipt_no", ["PAYROLL-SAL-2026-06", "PAYROLL-SAL-2026-07"]);
console.log(
  JSON.stringify(
    (sal.data ?? []).map((r) => ({
      receipt_no: r.receipt_no,
      amount: r.amount,
      payment_status: r.payment_status,
      expense_category: r.expense_category,
      notes: r.notes,
      updated_at: r.updated_at,
      created_at: r.created_at,
    })),
    null,
    2,
  ),
);

// Try direct SQL for triggers / audit / soft-delete columns
const candidates = buildDbCandidates(PROD);
console.log("\n=== DB URL candidates ===", candidates.length);
let client = null;
let lastErr = null;
for (const conn of candidates) {
  try {
    const c = new pg.Client({
      connectionString: conn,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    await c.connect();
    client = c;
    console.log("Connected via", conn.replace(/:[^:@/]+@/, ":***@"));
    break;
  } catch (e) {
    lastErr = e;
  }
}
if (!client) {
  console.log("PG connect failed:", lastErr?.message);
} else {
  const q = async (label, sql, params = []) => {
    try {
      const res = await client.query(sql, params);
      console.log(`\n--- ${label} ---`);
      console.log(JSON.stringify(res.rows, null, 2));
      return res.rows;
    } catch (e) {
      console.log(`\n--- ${label} ERROR ---`, e.message);
      return [];
    }
  };

  await q(
    "income_register columns",
    `select column_name, data_type, column_default, is_nullable
     from information_schema.columns
     where table_schema='public' and table_name='income_register'
     order by ordinal_position`,
  );

  await q(
    "income_register triggers",
    `select tgname, pg_get_triggerdef(oid) as def
     from pg_trigger
     where tgrelid = 'public.income_register'::regclass
       and not tgisinternal
     order by tgname`,
  );

  await q(
    "tables matching income/audit/history",
    `select table_name from information_schema.tables
     where table_schema='public'
       and (table_name ilike '%income%' or table_name ilike '%audit%' or table_name ilike '%history%')
     order by table_name`,
  );

  await q(
    "July id direct SQL (no RLS)",
    `select * from public.income_register where id = $1`,
    [JULY_ID],
  );

  await q(
    "July invoice direct SQL any tenant",
    `select * from public.income_register where invoice_no = $1`,
    ["PAYROLL-DEDSAV-2026-07"],
  );

  await q(
    "June DEDSAV direct SQL",
    `select * from public.income_register where invoice_no = $1`,
    ["PAYROLL-DEDSAV-2026-06"],
  );

  await q(
    "month_end_close July columns + row",
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='month_end_close'
     order by ordinal_position`,
  );

  await q(
    "month_end_close June/July raw",
    `select * from public.month_end_close
     where tenant_id = $1 and month in ('2026-06-01','2026-07-01')`,
    [TENANT],
  );

  // Check supabase logs schema if any
  await q(
    "schemas",
    `select schema_name from information_schema.schemata order by 1`,
  );

  await client.end();
}
