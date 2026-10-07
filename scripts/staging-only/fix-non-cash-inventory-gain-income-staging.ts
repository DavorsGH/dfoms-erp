/**
 * Staging: zero amount_received on Non-Cash inventory-gain income from 365 register links.
 *
 * npx tsx scripts/staging-only/fix-non-cash-inventory-gain-income-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error("Staging only");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: links, error: linkErr } = await admin
    .from("inventory_stock_adjustment_register_links")
    .select("tenant_id, income_register_id, amount, pl_kind")
    .not("income_register_id", "is", null);
  if (linkErr) throw linkErr;

  const incomeIds = [...new Set((links ?? []).map((l) => l.income_register_id as string))];
  if (incomeIds.length === 0) {
    console.log("No linked income rows.");
    return;
  }

  const { data: rows, error: incErr } = await admin
    .from("income_register")
    .select(
      "id, tenant_id, date, invoice_no, service_category, description, amount, amount_received, outstanding_balance, payment_status, business_unit_id",
    )
    .in("id", incomeIds);
  if (incErr) throw incErr;

  const toFix = (rows ?? []).filter((r) => {
    const ps = String(r.payment_status ?? "").trim().toLowerCase();
    const received = Number(r.amount_received) || 0;
    return ps === "non-cash" && received > 0;
  });

  console.log(`Linked income rows: ${rows?.length ?? 0}; need amount_received fix: ${toFix.length}`);
  for (const row of toFix) {
    console.log(
      JSON.stringify({
        id: row.id,
        tenant_id: row.tenant_id,
        date: row.date,
        amount: row.amount,
        amount_received: row.amount_received,
        description: row.description,
      }),
    );
    const { error: updErr } = await admin
      .from("income_register")
      .update({
        amount_received: 0,
        outstanding_balance: 0,
      })
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id);
    if (updErr) throw updErr;
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
