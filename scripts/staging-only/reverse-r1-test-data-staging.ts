/**
 * Remove Release 1 test inventory/payroll artifacts on staging via normal reversal paths.
 *
 * npx tsx scripts/staging-only/reverse-r1-test-data-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(STAGING_REF)) {
    throw new Error("Staging only (ref wieflwbfdmjtsdnwbfii)");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: batches } = await admin
    .from("production_batches")
    .select("id, batch_number")
    .eq("tenant_id", DAVORS)
    .or("batch_number.ilike.R1T-%,notes.ilike.%R1 user batch%");
  for (const b of batches ?? []) {
    const { error } = await admin.rpc("delete_production_batch", {
      p_batch_id: b.id,
    });
    console.log(
      `delete_production_batch ${b.batch_number} (${b.id}):`,
      error?.message ?? "OK",
    );
  }

  const { data: fpAdj } = await admin
    .from("finished_product_stock_adjustments")
    .select("id, reason")
    .eq("tenant_id", DAVORS)
    .or("reason.ilike.%R1 user test%,reason.ilike.%R1 API%,reason.eq.test");
  for (const row of fpAdj ?? []) {
    const { error } = await admin
      .from("finished_product_stock_adjustments")
      .delete()
      .eq("id", row.id);
    console.log(`FP adjustment delete ${row.id}:`, error?.message ?? "OK");
  }

  const { data: rmAdj } = await admin
    .from("raw_material_stock_adjustments")
    .select("id, reason")
    .eq("tenant_id", DAVORS)
    .or(
      "reason.ilike.%R1 user test%,reason.ilike.%R1 batch test%,reason.ilike.%R1 HTTP%",
    );
  for (const row of rmAdj ?? []) {
    const { error } = await admin
      .from("raw_material_stock_adjustments")
      .delete()
      .eq("id", row.id);
    console.log(`RM adjustment delete ${row.id}:`, error?.message ?? "OK");
  }

  for (const tenantId of [DAVORS, CAANTA]) {
    const { data: caFp } = await admin
      .from("finished_product_stock_adjustments")
      .select("id, reason")
      .eq("tenant_id", tenantId)
      .ilike("reason", "%R1 user test%");
    for (const row of caFp ?? []) {
      const { error } = await admin
        .from("finished_product_stock_adjustments")
        .delete()
        .eq("id", row.id);
      console.log(`FP (${tenantId}) ${row.id}:`, error?.message ?? "OK");
    }
  }

  const { data: icRows } = await admin
    .from("internal_consumption")
    .select("id, reason")
    .eq("tenant_id", DAVORS)
    .or("reason.ilike.%R1%,reason.ilike.%Release 1%");
  for (const row of icRows ?? []) {
    const { error } = await admin.rpc("delete_internal_consumption_entry", {
      p_tenant_id: DAVORS,
      p_entry_id: row.id,
    });
    console.log(`IC delete ${row.id}:`, error?.message ?? "OK");
  }

  const { data: caAdv } = await admin
    .from("salary_advance_register")
    .select("advance_id, approved_by, date_issued")
    .eq("tenant_id", CAANTA)
    .or(
      "approved_by.ilike.%R1 Test%,approved_by.ilike.%Release 1 proof%,approved_by.ilike.%R1 test%",
    );
  for (const row of caAdv ?? []) {
    const { error } = await admin.rpc("delete_salary_advance", {
      p_payload: { tenant_id: CAANTA, advance_id: row.advance_id },
    });
    console.log(`Advance delete ${row.advance_id}:`, error?.message ?? "OK");
  }

  const { data: testPayAcct } = await admin
    .from("payment_accounts")
    .select("id, account_name")
    .eq("tenant_id", CAANTA)
    .eq("account_name", "Release 1 staging cash");
  for (const acct of testPayAcct ?? []) {
    const { error } = await admin.from("payment_accounts").delete().eq("id", acct.id);
    console.log(`Payment account ${acct.id}:`, error?.message ?? "OK");
  }

  const { data: procTest } = await admin
    .from("payroll_processing")
    .select("id, department")
    .eq("tenant_id", CAANTA)
    .eq("department", "Release 1 test");
  for (const row of procTest ?? []) {
    const { error } = await admin.from("payroll_processing").delete().eq("id", row.id);
    console.log(`payroll_processing ${row.id}:`, error?.message ?? "OK");
  }

  console.log("\nDone. Run audit-r1-test-artifacts-staging.ts and readonly-davors-bs-all-scopes.ts.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
