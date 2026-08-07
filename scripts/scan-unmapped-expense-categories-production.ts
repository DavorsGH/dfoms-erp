/**
 * Read-only: scan all tenants for unmapped expense_category values (production).
 * Usage: npx tsx scripts/scan-unmapped-expense-categories-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isMappedProfitLossExpenseCategory } from "../app/dashboard/finance/profit-loss-utils";

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
  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) throw new Error(`Refusing non-production: ${url}`);

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: tenants } = await admin.from("tenants").select("id, name, slug");
  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  const { data: lookupCats } = await admin
    .from("expense_categories")
    .select("name")
    .order("name");
  const lookupUnmapped = (lookupCats ?? [])
    .map((c) => c.name)
    .filter((name) => !isMappedProfitLossExpenseCategory(name));

  console.log("=== Production lookup: categories without P&L mapping ===");
  console.log(lookupUnmapped);

  const { data: rows } = await admin
    .from("expense_register")
    .select("tenant_id, expense_category, amount, date, receipt_no, payment_status");

  const byCategory = new Map();
  for (const row of rows ?? []) {
    const cat = (row.expense_category ?? "").trim();
    if (!cat || isMappedProfitLossExpenseCategory(cat)) continue;
    const bucket = byCategory.get(cat) ?? {
      tenants: new Map(),
      rows: [],
      totalAmount: 0,
    };
    const tName = tenantName.get(row.tenant_id) ?? row.tenant_id;
    bucket.tenants.set(row.tenant_id, tName);
    bucket.rows.push(row);
    bucket.totalAmount += Number(row.amount) || 0;
    byCategory.set(cat, bucket);
  }

  console.log("\n=== Production: expenses using unmapped categories ===");
  for (const [cat, stats] of [...byCategory.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(
      JSON.stringify({
        category: cat,
        tenants: [...stats.tenants.values()],
        rowCount: stats.rows.length,
        totalAmount: Math.round(stats.totalAmount * 100) / 100,
        sampleReceipts: stats.rows.slice(0, 5).map((r) => r.receipt_no),
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
