/**
 * Staging: Phase 4 offline POS cash sync + conflict + resolve A/B/C (RPC-level).
 *
 *   npx tsx scripts/_test-offline-pos-cash-sale-phase4-staging.ts --env-file .env.staging.local
 *
 * Uses service role + set_config for tenant context where needed.
 * Creates temporary finished product stock, runs sync happy-path + conflict, resolves A.
 * Cleans up rows it creates.
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

type Check = { step: string; pass: boolean; detail?: string };

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `expected staging ref ${STAGING_REF}`);
  assert(Boolean(key), "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks: Check[] = [];
  const record = (step: string, pass: boolean, detail?: string) => {
    checks.push({ step, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"} ${step}${detail ? ` — ${detail}` : ""}`);
  };

  const stamp = Date.now();
  const productCode = `P4-FP-${stamp}`;
  let productId: string | null = null;
  const cleanOpIds: string[] = [];
  const conflictIds: string[] = [];
  const incomeIds: string[] = [];

  try {
    const { data: product, error: pErr } = await admin
      .from("finished_products")
      .insert({
        tenant_id: DAVORS,
        product_code: productCode,
        product_name: `Phase4 Offline Test ${stamp}`,
        unit_of_measure: "pcs",
        current_stock: 5,
        standard_selling_price: 10,
        sourcing_type: "purchased",
        is_archived: false,
      })
      .select("id")
      .single();
    if (pErr || !product?.id) {
      throw new Error(`seed product failed: ${pErr?.message}`);
    }
    productId = product.id;
    record("seed finished product stock=5", true, productId);

    // Seed a purchase lot so WAC > 0 for COGS
    await admin.from("product_purchases").insert({
      tenant_id: DAVORS,
      product_id: productId,
      purchase_date: "2026-08-01",
      quantity: 5,
      cost_per_unit: 4,
      total_cost: 20,
      payment_method: "Cash",
    });

    // --- Happy path: qty 2 of 5 ---
    const opOk = crypto.randomUUID();
    cleanOpIds.push(opOk);
    const { data: syncOk, error: syncOkErr } = await admin.rpc(
      "sync_offline_pos_cash_sale",
      {
        p_client_op_id: opOk,
        p_payload: {
          sale_date: "2026-08-24",
          client_id: null,
          customer_name: "Walk-in Phase4",
          payment_method: "Cash",
          amount_received: 20,
          notes: null,
          provisional_token: `OFF-TEST-${stamp}-OK`,
          sales_rep_id: null,
          lines: [
            {
              product_id: productId,
              product_code: productCode,
              product_name: "Phase4",
              quantity: 2,
              unit_price: 10,
            },
          ],
        },
      },
    );
    record(
      "sync happy-path RPC",
      !syncOkErr && syncOk?.status === "synced",
      syncOkErr?.message ?? JSON.stringify(syncOk),
    );
    if (syncOk?.income_ids) {
      incomeIds.push(...(syncOk.income_ids as string[]));
    }

    // Idempotent retry
    const { data: syncRetry } = await admin.rpc("sync_offline_pos_cash_sale", {
      p_client_op_id: opOk,
      p_payload: {
        sale_date: "2026-08-24",
        payment_method: "Cash",
        amount_received: 20,
        provisional_token: `OFF-TEST-${stamp}-OK`,
        lines: [
          {
            product_id: productId,
            product_code: productCode,
            product_name: "Phase4",
            quantity: 2,
            unit_price: 10,
          },
        ],
      },
    });
    record(
      "sync idempotent retry",
      syncRetry?.status === "synced" &&
        syncRetry?.invoice_no === syncOk?.invoice_no,
      JSON.stringify(syncRetry),
    );

    const { data: stockAfterOk } = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", productId)
      .single();
    record(
      "stock after happy sync = 3",
      Number(stockAfterOk?.current_stock) === 3,
      String(stockAfterOk?.current_stock),
    );

    // --- Conflict: claim 10 when only 3 left ---
    const opConflict = crypto.randomUUID();
    cleanOpIds.push(opConflict);
    const { data: syncConflict, error: syncConflictErr } = await admin.rpc(
      "sync_offline_pos_cash_sale",
      {
        p_client_op_id: opConflict,
        p_payload: {
          sale_date: "2026-08-24",
          client_id: null,
          customer_name: "Conflict Walk-in",
          payment_method: "Cash",
          amount_received: 100,
          notes: null,
          provisional_token: `OFF-TEST-${stamp}-CF`,
          sales_rep_id: null,
          lines: [
            {
              product_id: productId,
              product_code: productCode,
              product_name: "Phase4",
              quantity: 10,
              unit_price: 10,
            },
          ],
        },
      },
    );
    record(
      "sync conflict path",
      !syncConflictErr && syncConflict?.status === "conflict",
      syncConflictErr?.message ?? JSON.stringify(syncConflict),
    );
    const conflictId = String(syncConflict?.conflict_id ?? "");
    conflictIds.push(conflictId);
    if (syncConflict?.suspense_income_id) {
      incomeIds.push(String(syncConflict.suspense_income_id));
    }

    const { data: suspense } = await admin
      .from("income_register")
      .select("id, invoice_no, entry_type, amount_received, payment_status")
      .eq("id", syncConflict?.suspense_income_id)
      .maybeSingle();
    record(
      "suspense OSC income booked",
      suspense?.entry_type === "offline_cash_suspense" &&
        Number(suspense.amount_received) === 100 &&
        String(suspense.invoice_no ?? "").includes("-OSC-"),
      JSON.stringify(suspense),
    );

    const { data: stockUnchanged } = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", productId)
      .single();
    record(
      "conflict does not decrement stock",
      Number(stockUnchanged?.current_stock) === 3,
      String(stockUnchanged?.current_stock),
    );

    // --- Resolve A: post qty 2 of 3, remainder cash → misc_income ---
    const { data: resolveA, error: resolveAErr } = await admin.rpc(
      "resolve_offline_sale_conflict",
      {
        p_conflict_id: conflictId,
        p_action: "A",
        p_params: {
          confirmed_lines: [{ product_id: productId, quantity: 2 }],
          cash_difference_action: "misc_income",
          cash_difference_note: "Phase4 test remainder",
        },
      },
    );
    record(
      "resolve A",
      !resolveAErr && resolveA?.status === "resolved_a",
      resolveAErr?.message ?? JSON.stringify(resolveA),
    );

    const { data: stockAfterA } = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", productId)
      .single();
    record(
      "stock after resolve A = 1",
      Number(stockAfterA?.current_stock) === 1,
      String(stockAfterA?.current_stock),
    );

    const { data: clearedSuspense } = await admin
      .from("income_register")
      .select("payment_status, amount_received")
      .eq("id", syncConflict?.suspense_income_id)
      .maybeSingle();
    record(
      "suspense cleared after resolve A",
      clearedSuspense?.payment_status === "Cleared" &&
        r2(Number(clearedSuspense.amount_received)) === 0,
      JSON.stringify(clearedSuspense),
    );

    // MoMo payload rejected
    const { data: momoReject, error: momoErr } = await admin.rpc(
      "sync_offline_pos_cash_sale",
      {
        p_client_op_id: crypto.randomUUID(),
        p_payload: {
          sale_date: "2026-08-24",
          payment_method: "Mobile Money",
          amount_received: 10,
          provisional_token: `OFF-TEST-${stamp}-MOMO`,
          lines: [
            {
              product_id: productId,
              product_code: productCode,
              product_name: "Phase4",
              quantity: 1,
              unit_price: 10,
            },
          ],
        },
      },
    );
    record(
      "MoMo payload rejected by sync RPC",
      Boolean(momoErr) ||
        momoReject?.status === "error" ||
        Boolean(momoReject?.error),
      momoErr?.message ?? JSON.stringify(momoReject),
    );
  } finally {
    // Cleanup best-effort
    for (const id of conflictIds.filter(Boolean)) {
      await admin.from("offline_sale_conflicts").delete().eq("id", id);
    }
    for (const id of cleanOpIds) {
      await admin.from("offline_pos_ops").delete().eq("client_op_id", id);
    }
    if (incomeIds.length) {
      await admin.from("income_register").delete().in("id", incomeIds);
    }
    if (productId) {
      await admin.from("stock_movements").delete().eq("product_id", productId);
      await admin.from("product_purchases").delete().eq("product_id", productId);
      await admin
        .from("expense_register")
        .delete()
        .eq("tenant_id", DAVORS)
        .ilike("description", `%${productCode}%`);
      await admin.from("finished_products").delete().eq("id", productId);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
