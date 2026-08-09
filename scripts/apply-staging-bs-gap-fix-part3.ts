/**
 * Apply David-approved staging BS gap fixes Part 3A + 3B (Davors FY2026).
 * Staging only — refuses non-staging project ref.
 *
 * Usage: npx tsx scripts/apply-staging-bs-gap-fix-part3.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";

const ORPHAN_VAT_REMIT_ID = "51e5f294-1f33-46ed-baff-08a1aa1633b6";
const ORPHAN_VAT_REMIT_RECEIPT = "TAX-REMIT-VAT-2026-06";
const MANUAL_PERIOD_MONTH = "2026-07-01";
const MANUAL_NOTES_SUFFIX =
  " [Staging hygiene — zeroed stale Jul-2026 overrides 2026-08-08]";

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING), `Refusing: expected staging (${STAGING}), got ${url}`);

  const admin = createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log("=== Part 3A: delete orphan TAX-REMIT-VAT-2026-06 ===");

  const { data: beforeRemit, error: beforeRemitErr } = await admin
    .from("expense_register")
    .select("id, receipt_no, amount, date")
    .eq("id", ORPHAN_VAT_REMIT_ID)
    .eq("tenant_id", TENANT)
    .eq("receipt_no", ORPHAN_VAT_REMIT_RECEIPT)
    .maybeSingle();
  assert(!beforeRemitErr, `probe orphan remit: ${beforeRemitErr?.message}`);
  assert(beforeRemit, "Orphan VAT remittance row not found — already deleted?");
  console.log("Found:", beforeRemit);

  const { error: delErr, count: delCount } = await admin
    .from("expense_register")
    .delete({ count: "exact" })
    .eq("id", ORPHAN_VAT_REMIT_ID)
    .eq("tenant_id", TENANT)
    .eq("receipt_no", ORPHAN_VAT_REMIT_RECEIPT);
  assert(!delErr, `delete orphan remit: ${delErr?.message}`);
  console.log(`Deleted ${delCount ?? 0} expense_register row (expected 1)`);
  assert(delCount === 1, `Expected 1 deleted row, got ${delCount ?? 0}`);

  console.log("\n=== Part 3B: zero stale manual_financial_entries Jul-2026 ===");

  const { data: beforeManual, error: beforeManualErr } = await admin
    .from("manual_financial_entries")
    .select("period_month, vat_payable, share_capital, notes")
    .eq("tenant_id", TENANT)
    .eq("period_month", MANUAL_PERIOD_MONTH)
    .maybeSingle();
  assert(!beforeManualErr, `probe manual entry: ${beforeManualErr?.message}`);
  assert(beforeManual, "Manual entry for 2026-07-01 not found");
  console.log("Before:", beforeManual);

  const updatedNotes = `${beforeManual.notes ?? ""}${MANUAL_NOTES_SUFFIX}`;
  const { error: updErr, count: updCount } = await admin
    .from("manual_financial_entries")
    .update({
      vat_payable: 0,
      share_capital: 0,
      notes: updatedNotes,
    })
    .eq("tenant_id", TENANT)
    .eq("period_month", MANUAL_PERIOD_MONTH);
  assert(!updErr, `update manual entry: ${updErr?.message}`);

  const { data: afterManual, error: afterManualErr } = await admin
    .from("manual_financial_entries")
    .select("period_month, vat_payable, share_capital, notes")
    .eq("tenant_id", TENANT)
    .eq("period_month", MANUAL_PERIOD_MONTH)
    .maybeSingle();
  assert(!afterManualErr, `verify manual entry: ${afterManualErr?.message}`);
  console.log("After:", afterManual);
  assert(afterManual?.vat_payable === 0, "vat_payable not zeroed");
  assert(afterManual?.share_capital === 0, "share_capital not zeroed");
  assert(
    String(afterManual?.notes ?? "").includes(MANUAL_NOTES_SUFFIX.trim()),
    "notes annotation missing",
  );

  console.log("\n✓ Staging fixes Part 3A + 3B applied successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
