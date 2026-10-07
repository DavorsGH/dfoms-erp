/**
 * Read-only production: Non-Cash income with amount_received > 0.
 *
 * npx tsx scripts/audits/readonly-production-non-cash-income-cash-impact.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROD_REF = "tvcurcnmasnocwdxzgvz";

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

async function main() {
  loadEnv(resolve(".env.local.production-backup-2026-08-25"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) {
    throw new Error("Production env required");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: tenants } = await admin.from("tenants").select("id, name");
  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  const { data: rows, error } = await admin
    .from("income_register")
    .select(
      "id, tenant_id, business_unit_id, date, invoice_no, service_category, description, amount, amount_received, outstanding_balance, payment_status, entry_type",
    )
    .ilike("payment_status", "Non-Cash")
    .gt("amount_received", 0)
    .order("date", { ascending: true });
  if (error) throw error;

  const { data: buRows } = await admin.from("business_units").select("id, name, tenant_id");
  const buName = new Map(
    (buRows ?? []).map((b) => [`${b.tenant_id}:${b.id}`, b.name]),
  );

  const { data: adjLinks } = await admin
    .from("inventory_stock_adjustment_register_links")
    .select("income_register_id, source_kind, adjustment_id, pl_kind, amount");
  const linkByIncome = new Map(
    (adjLinks ?? [])
      .filter((l) => l.income_register_id)
      .map((l) => [String(l.income_register_id), l]),
  );

  console.log(`Rows (Non-Cash, amount_received > 0): ${rows?.length ?? 0}\n`);

  for (const row of rows ?? []) {
    const link = linkByIncome.get(String(row.id));
    const bu =
      row.business_unit_id != null
        ? buName.get(`${row.tenant_id}:${row.business_unit_id}`) ?? row.business_unit_id
        : "NULL";
    const legacyCashHit = Number(row.amount_received) || 0;
    const newCashHit = 0;
    console.log(
      [
        tenantName.get(row.tenant_id) ?? row.tenant_id,
        bu,
        String(row.date).slice(0, 10),
        row.invoice_no ?? "—",
        row.service_category ?? "—",
        (row.description ?? "").slice(0, 60),
        `amount=${row.amount}`,
        `received=${row.amount_received}`,
        link ? `365-link:${link.source_kind}/${link.pl_kind}` : "not-365-link",
        `OLD cash adds ${legacyCashHit}`,
        `NEW cash adds ${newCashHit}`,
        legacyCashHit !== newCashHit ? "CASH CHANGES" : "cash unchanged",
      ].join(" | "),
    );
  }

  const payrollDed = (rows ?? []).filter((r) =>
    String(r.invoice_no ?? "").startsWith("PAYROLL-"),
  );
  console.log(`\nPAYROLL-* invoice rows in this set: ${payrollDed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
