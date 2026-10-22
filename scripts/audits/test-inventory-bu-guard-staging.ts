/**
 * Staging guard tests (no intentional data writes).
 *
 * npx tsx scripts/audits/test-inventory-bu-guard-staging.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateFinishedProductWriteBusinessUnit,
  evaluateRawMaterialWriteBusinessUnit,
  shouldApplyInventoryItemBusinessUnitGuard,
  type InventoryItemBusinessUnitAction,
} from "../../lib/inventory/inventory-item-business-unit-guard";
import {
  verifyFinishedProductMatchesWriteBusinessUnit,
  verifyPosCartLinesMatchWriteBusinessUnit,
} from "../../lib/inventory/inventory-item-business-unit-guard.client";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const ENTERPRISE_BU = "3b787f50-de08-40d5-af9c-14523a63503c";
const FACILITIES_BU = "de215200-e92b-48e3-a7ba-977d7289868c";

const ACTIONS: InventoryItemBusinessUnitAction[] = [
  "purchase",
  "purchase_order",
  "sale",
  "stock_adjustment",
  "internal_use",
  "production",
  "return",
];

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectAllow(
  label: string,
  result: { ok: true } | { ok: false; message: string },
) {
  if (!result.ok) {
    throw new Error(`${label}: expected ALLOW, got REFUSE — ${result.message}`);
  }
  console.log(`  PASS ALLOW — ${label}`);
}

function expectRefuse(
  label: string,
  result: { ok: true } | { ok: false; message: string },
) {
  if (result.ok) {
    throw new Error(`${label}: expected REFUSE, got ALLOW`);
  }
  console.log(`  PASS REFUSE — ${label}`);
}

function runSimulatedNoBuMatrix() {
  console.log("\n=== Simulated no-BU tenant (pure helper) ===");
  for (const action of ACTIONS) {
    for (const writeBu of [null, undefined, ""] as const) {
      expectAllow(
        `${action} product=null write=${String(writeBu)} tenantUsesBu=false`,
        evaluateFinishedProductWriteBusinessUnit({
          tenantUsesBusinessUnits: false,
          productBusinessUnitId: null,
          writeBusinessUnitId: writeBu,
          businessUnitLabel: "n/a",
          action,
        }),
      );
    }
    expectAllow(
      `${action} product=null write=enterprise tenantUsesBu=false`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: false,
        productBusinessUnitId: null,
        writeBusinessUnitId: ENTERPRISE_BU,
        businessUnitLabel: "n/a",
        action,
      }),
    );
    expectAllow(
      `${action} product=null write=null tenantUsesBu=true (skip guard)`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: true,
        productBusinessUnitId: null,
        writeBusinessUnitId: null,
        businessUnitLabel: "n/a",
        action,
      }),
    );
    expectAllow(
      `${action} product=facilities write=null tenantUsesBu=true (skip guard)`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: true,
        productBusinessUnitId: FACILITIES_BU,
        writeBusinessUnitId: null,
        businessUnitLabel: "Davors Facilities",
        action,
      }),
    );
    expectAllow(
      `${action} raw material null/null tenantUsesBu=true`,
      evaluateRawMaterialWriteBusinessUnit({
        tenantUsesBusinessUnits: true,
        materialBusinessUnitId: null,
        writeBusinessUnitId: null,
        businessUnitLabel: "n/a",
        action,
      }),
    );
  }

  assert(
    !shouldApplyInventoryItemBusinessUnitGuard({
      tenantUsesBusinessUnits: true,
      catalogBusinessUnitId: null,
      writeBusinessUnitId: ENTERPRISE_BU,
    }),
    "null catalog + non-null write must not apply guard",
  );
  assert(
    !shouldApplyInventoryItemBusinessUnitGuard({
      tenantUsesBusinessUnits: true,
      catalogBusinessUnitId: FACILITIES_BU,
      writeBusinessUnitId: undefined,
    }),
    "non-null catalog + undefined write must not apply guard",
  );
  console.log("  PASS — shouldApplyInventoryItemBusinessUnitGuard edge cases");
}

function runDavorsMatrix() {
  console.log("\n=== Davors (tenant uses BUs, both sides non-null) ===");
  for (const action of ACTIONS) {
    expectRefuse(
      `${action} Facilities product + Enterprise write`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: true,
        productBusinessUnitId: FACILITIES_BU,
        writeBusinessUnitId: ENTERPRISE_BU,
        businessUnitLabel: "Davors Facilities",
        action,
      }),
    );
    expectAllow(
      `${action} Facilities product + Facilities write`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: true,
        productBusinessUnitId: FACILITIES_BU,
        writeBusinessUnitId: FACILITIES_BU,
        businessUnitLabel: "Davors Facilities",
        action,
      }),
    );
  }
}

async function runStagingCatalogChecks(
  admin: ReturnType<typeof createClient>,
) {
  console.log("\n=== Staging catalog-backed checks (read-only) ===");

  const { count: caantaBuCount } = await admin
    .from("business_units")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", CAANTA)
    .eq("is_active", true);
  console.log(
    `  Caanta active business_units on staging: ${caantaBuCount ?? 0} (production has 0; staging may differ)`,
  );

  const { data: caantaProduct } = await admin
    .from("finished_products")
    .select("id, product_code, business_unit_id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  assert(caantaProduct?.id, "Caanta needs at least one finished product");

  const caantaClientCheck = await verifyFinishedProductMatchesWriteBusinessUnit({
    supabase: admin,
    tenantId: CAANTA,
    productId: String(caantaProduct.id),
    writeBusinessUnitId: null,
    action: "sale",
    knownProductBusinessUnitId:
      (caantaProduct as { business_unit_id?: string | null }).business_unit_id ??
      null,
  });
  expectAllow("Caanta POS path (client verifier, null write BU)", caantaClientCheck);

  const { data: sku1003 } = await admin
    .from("finished_products")
    .select("id, business_unit_id")
    .eq("tenant_id", DAVORS)
    .eq("product_code", "SKU-1003")
    .maybeSingle();
  assert(sku1003?.id, "SKU-1003 missing on staging Davors");

  expectRefuse(
    "Davors SKU-1003 Enterprise write (client verifier)",
    await verifyFinishedProductMatchesWriteBusinessUnit({
      supabase: admin,
      tenantId: DAVORS,
      productId: String(sku1003.id),
      writeBusinessUnitId: ENTERPRISE_BU,
      action: "purchase",
    }),
  );
  expectAllow(
    "Davors SKU-1003 Facilities write (client verifier)",
    await verifyFinishedProductMatchesWriteBusinessUnit({
      supabase: admin,
      tenantId: DAVORS,
      productId: String(sku1003.id),
      writeBusinessUnitId: FACILITIES_BU,
      action: "purchase",
    }),
  );

  const { data: tenants } = await admin.from("tenants").select("id, name");
  for (const tenant of tenants ?? []) {
    const { count: buCount } = await admin
      .from("business_units")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("is_active", true);
    if ((buCount ?? 0) !== 0) {
      continue;
    }
    const { data: product } = await admin
      .from("finished_products")
      .select("id, business_unit_id")
      .eq("tenant_id", tenant.id)
      .limit(1)
      .maybeSingle();
    if (!product?.id) {
      continue;
    }
    expectAllow(
      `${tenant.name} (0 BUs) null/null`,
      evaluateFinishedProductWriteBusinessUnit({
        tenantUsesBusinessUnits: false,
        productBusinessUnitId:
          (product as { business_unit_id?: string | null }).business_unit_id ??
          null,
        writeBusinessUnitId: null,
        businessUnitLabel: "n/a",
        action: "sale",
      }),
    );
    break;
  }

  if ((caantaBuCount ?? 0) > 0) {
    const caantaBuId = (
      await admin
        .from("business_units")
        .select("id")
        .eq("tenant_id", CAANTA)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()
    ).data?.id;
    if (caantaProduct && caantaBuId) {
      const productBu =
        (caantaProduct as { business_unit_id?: string | null }).business_unit_id ??
        null;
      expectAllow(
        "Caanta null catalog BU + null write BU (guard skipped)",
        evaluateFinishedProductWriteBusinessUnit({
          tenantUsesBusinessUnits: true,
          productBusinessUnitId: productBu,
          writeBusinessUnitId: null,
          businessUnitLabel: "n/a",
          action: "sale",
        }),
      );
    }
  }
}

async function runCaantaPosDisposableCheckout(
  admin: ReturnType<typeof createClient>,
): Promise<void> {
  console.log("\n=== Caanta POS checkout (staging RPC, disposable) ===");
  const tag = `BU-GUARD-${Date.now().toString(36).toUpperCase()}`;
  const saleDate = new Date().toISOString().slice(0, 10);

  const { data: product } = await admin
    .from("finished_products")
    .select("id, product_code, product_name, current_stock, business_unit_id")
    .eq("tenant_id", CAANTA)
    .eq("is_archived", false)
    .gt("current_stock", 1)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!product?.id) {
    console.log("  SKIP — no Caanta in-stock product for disposable POS test");
    return;
  }

  const productId = String(product.id);
  const cartCheck = await verifyPosCartLinesMatchWriteBusinessUnit({
    supabase: admin,
    tenantId: CAANTA,
    productIds: [productId],
    writeBusinessUnitId: null,
    productBusinessUnitById: new Map([
      [productId, (product as { business_unit_id?: string | null }).business_unit_id ?? null],
    ]),
  });
  expectAllow("Caanta checkout_pos_cart preflight (null write BU)", cartCheck);

  const { data: checkoutResult, error: checkoutError } = await admin.rpc(
    "checkout_pos_cart",
    {
      p_tenant_id: CAANTA,
      p_business_unit_id: null,
      p_sale_date: saleDate,
      p_invoice_no: null,
      p_client_id: null,
      p_customer_name: "BU guard disposable test",
      p_payment_status: "Paid",
      p_due_date: saleDate,
      p_notes: tag,
      p_payment_method: "Cash",
      p_sales_rep_id: null,
      p_amount_received: 10,
      p_lines: [
        {
          product_id: productId,
          quantity: 1,
          unit_price: 10,
          product_code: String(product.product_code ?? ""),
          product_name: String(product.product_name ?? ""),
        },
      ],
      p_payment_request_id: null,
      p_paid_amount: null,
      p_paystack_reference: null,
      p_paid_at: null,
    },
  );

  if (checkoutError) {
    throw new Error(`checkout_pos_cart failed: ${checkoutError.message}`);
  }

  const incomeIds = (
    (checkoutResult as { income_ids?: string[] } | null)?.income_ids ?? []
  ).filter(Boolean);
  assert(incomeIds.length > 0, "checkout_pos_cart returned no income_ids");
  console.log(`  PASS — checkout_pos_cart created ${incomeIds.length} income row(s)`);

  for (const incomeId of incomeIds) {
    const { error: voidError } = await admin.rpc("void_product_sale", {
      p_income_id: incomeId,
    });
    if (voidError) {
      console.log(
        `  WARN — void_product_sale(${incomeId}): ${voidError.message} (reverse manually if needed)`,
      );
    } else {
      console.log(`  PASS — void_product_sale reversed ${incomeId}`);
    }
  }
}

async function tryLocalhostPosGuardOnly(): Promise<void> {
  console.log("\n=== Localhost POS (guard preflight only — no checkout POST) ===");
  const base = process.env.INVENTORY_BU_GUARD_TEST_BASE_URL ?? "http://localhost:3000";
  try {
    const heartbeat = await fetch(`${base}/api/heartbeat`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!heartbeat.ok) {
      console.log(
        `  SKIP — ${base} heartbeat HTTP ${heartbeat.status} (start \`npm run dev\` for full browser POS E2E)`,
      );
      return;
    }
    console.log(`  PASS — dev server reachable at ${base}`);
    console.log(
      "  NOTE — Authenticated POS checkout requires a logged-in session in the browser; guard preflight for Caanta already passed via staging client verifier above.",
    );
  } catch {
    console.log(
      `  SKIP — no dev server at ${base} (guard logic verified via staging; run manual POS on Caanta staging user to confirm UI checkout).`,
    );
  }
}

async function main() {
  const runPosDisposable = process.argv.includes("--pos-disposable-staging");
  const repoRoot = resolve(process.cwd());
  loadEnvForce(resolve(repoRoot, ".env.staging.local"));
  if (existsSync(resolve(repoRoot, ".env.local"))) {
    loadEnvForce(resolve(repoRoot, ".env.local"));
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing: expected staging Supabase URL, got ${url || "(empty)"}`);
  }

  runSimulatedNoBuMatrix();
  runDavorsMatrix();

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await runStagingCatalogChecks(admin);
  await tryLocalhostPosGuardOnly();
  if (runPosDisposable) {
    await runCaantaPosDisposableCheckout(admin);
  } else {
    console.log(
      "\n(Skip Caanta POS RPC write test — pass --pos-disposable-staging to checkout + void on staging)",
    );
  }

  console.log("\nAll inventory BU guard staging tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
