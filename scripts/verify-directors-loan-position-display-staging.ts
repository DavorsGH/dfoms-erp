/**
 * Staging: verify normalizeDirectorsLoanPositionDisplay on live ledger position.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  calculateDirectorsLoanPositionAsAt,
  normalizeDirectorsLoanPositionDisplay,
} from "../app/dashboard/finance/directors-loan-ledger-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";

for (const line of readFileSync(resolve(process.cwd(), ".env.staging.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  const { data: entries } = await admin
    .from("directors_loan_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .is("reversed_at", null);
  const { data: ap } = await admin
    .from("accounts_payable_payments")
    .select("tenant_id, payment_date, amount, payment_source")
    .eq("tenant_id", TENANT);

  const asAt = "2026-12-31";
  const raw = calculateDirectorsLoanPositionAsAt(
    (entries ?? []) as Parameters<typeof calculateDirectorsLoanPositionAsAt>[0],
    (ap ?? []) as Parameters<typeof calculateDirectorsLoanPositionAsAt>[1],
    TENANT,
    asAt,
    2026,
  );
  const display = normalizeDirectorsLoanPositionDisplay(raw);
  console.log("Raw position:", raw);
  console.log("Display position:", display);
  if (display.owedToDirector < -0.01 || display.owedByDirector < -0.01) {
    throw new Error("Display amounts must be non-negative");
  }
  const overRepaid = normalizeDirectorsLoanPositionDisplay({
    owedToDirector: -3000,
    owedByDirector: 0,
    netPosition: -3000,
  });
  if (overRepaid.owedToDirector !== 0 || overRepaid.owedByDirector !== 3000) {
    throw new Error(`Expected 0 / 3000 display flip, got ${JSON.stringify(overRepaid)}`);
  }
  console.log("Synthetic over-repaid display:", overRepaid);
  console.log("PASS position display normalization (staging Davors, as-at Dec 2026).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
