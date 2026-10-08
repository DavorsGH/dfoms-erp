/**
 * Disposable Caanta staging test: sell → full return → cancel (void_product_sale).
 * Measures stock, income, COGS before/after each step.
 *
 *   npx tsx scripts/test-void-after-full-return-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TAG = `RET-VOID-${Date.now().toString(36).toUpperCase()}`;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r4(n: unknown) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function snapshot(
  admin: ReturnType<typeof createClient>,
  productId: string,
  incomeId: string,
) {
  const [{ data: fp }, { data: fpb }, { data: sale }, { data: movements }] =
    await Promise.all([
      admin
        .from("finished_products")
        .select("current_stock")
        .eq("id", productId)
        .single(),
      admin
        .from("finished_product_balances")
        .select("current_stock, business_unit_id")
        .eq("tenant_id", CAANTA)
        .eq("product_id", productId),
      admin
        .from("income_register")
        .select(
          "sale_status, amount, amount_received, cogs_expense_id, cogs_reversal_expense_id",
        )
        .eq("id", incomeId)
        .single(),
      admin
        .from("stock_movements")
        .select("movement_type, quantity, notes")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const cogsIds = [
    sale?.cogs_expense_id,
    sale?.cogs_reversal_expense_id,
  ].filter(Boolean);
  let cogsSum = 0;
  if (cogsIds.length) {
    const { data: expenses } = await admin
      .from("expense_register")
      .select("amount, receipt_no, description")
      .in("id", cogsIds);
    cogsSum = (expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }

  return {
    masterStock: r4(fp?.current_stock),
    buBalances: (fpb ?? []).map((r) => ({
      bu: r.business_unit_id,
      stock: r4(r.current_stock),
    })),
    saleStatus: sale?.sale_status,
    incomeAmount: r4(sale?.amount),
    cogsLinkedSum: r4(cogsSum),
    recentMovements: movements ?? [],
  };
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), "Not staging Supabase URL");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const today = new Date();
  const saleDate = today.toISOString().slice(0, 10);

  const { data: buRow } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", CAANTA)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const buId = buRow?.id ?? null;

  const { data: stockProduct } = await admin
    .from("finished_products")
    .select("id, product_code, current_stock")
    .eq("tenant_id", CAANTA)
    .eq("is_archived", false)
    .gt("current_stock", 3)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert(stockProduct?.id, "Need a Caanta finished product with stock > 3 on staging");
  const productId = stockProduct.id;

  const qty = 2;
  const unitPrice = 15;
  const invoiceNo = `DF-POS-${TAG}`;

  const { data: incomeId, error: saleErr } = await admin.rpc("create_product_sale", {
    p_date: saleDate,
    p_invoice_no: invoiceNo,
    p_client_id: null,
    p_customer_name: "Return void test",
    p_product_id: productId,
    p_quantity: qty,
    p_unit_price: unitPrice,
    p_amount_received: r4(qty * unitPrice),
    p_payment_status: "Paid",
    p_due_date: null,
    p_description: TAG,
    p_notes: TAG,
    p_invoice_entity_type: "POS",
    p_sales_rep_id: null,
    p_business_unit_id: buId,
  });
  assert(!saleErr && incomeId, saleErr?.message ?? "create_product_sale failed");

  const afterSale = await snapshot(admin, productId, incomeId);
  console.log("\n=== After sale ===");
  console.log(JSON.stringify({ incomeId, invoiceNo, ...afterSale }, null, 2));

  const { client: pg } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  let retData: unknown;
  try {
    const ua = await pg.query(
      `SELECT auth_uid FROM user_accounts WHERE tenant_id = $1 AND COALESCE(is_active, true) = true LIMIT 1`,
      [CAANTA],
    );
    assert(ua.rows[0]?.auth_uid, "Need Caanta user_accounts row");
    const authUid = ua.rows[0].auth_uid as string;
    await pg.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authUid]);
    await pg.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);

    const linesJson = JSON.stringify([
      {
        income_register_id: incomeId,
        product_id: productId,
        quantity: qty,
        unit_price: unitPrice,
        disposition: "restock",
      },
    ]);

    const retRes = await pg.query(
      `SELECT public.pos_product_return_and_refund_now(
         $1::uuid, $2::uuid, $3::date, $4::text, $5::text, $6::jsonb, $7::text, $8::text
       ) AS result`,
      [
        CAANTA,
        buId,
        saleDate,
        invoiceNo,
        `Test full return ${TAG}`,
        linesJson,
        "Cash",
        TAG,
      ],
    );
    retData = retRes.rows[0]?.result;
  } finally {
    await pg.end();
  }
  console.log("\n=== Return RPC ===");
  console.log(retData);

  const afterReturn = await snapshot(admin, productId, incomeId);
  console.log("\n=== After full return ===");
  console.log(JSON.stringify(afterReturn, null, 2));

  const { error: voidErr } = await admin.rpc("void_product_sale", {
    p_income_id: incomeId,
  });

  console.log("\n=== void_product_sale result ===");
  console.log(voidErr ? { blocked: false, error: voidErr.message } : { blocked: false, ok: true });

  if (!voidErr) {
    const afterVoid = await snapshot(admin, productId, incomeId);
    console.log("\n=== After void (double reversal check) ===");
    console.log(JSON.stringify(afterVoid, null, 2));
    console.log("\nStock delta sale→return:", {
      master: r4(afterReturn.masterStock - afterSale.masterStock),
      afterVoidVsReturn: r4(afterVoid.masterStock - afterReturn.masterStock),
    });
    console.log("COGS sum delta return→void:", r4(afterVoid.cogsLinkedSum - afterReturn.cogsLinkedSum));
  }

  console.log("\nTAG for manual cleanup:", TAG);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
