/**
 * Probe Tenant Management UUID/email error on staging.
 *
 *   npx tsx scripts/probe-tenant-management-uuid-error-staging.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

const TARGET_EMAIL = "david.avors@gmail.com";

loadEnvForce(resolve(process.cwd(), ".env.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== 1. Stepwise Supabase queries (Tenant Management page load) ===");

  const tenantsRes = await admin
    .from("tenants")
    .select("id, name, status, created_at")
    .neq("id", DAVORS_TENANT_ID)
    .order("created_at", { ascending: false });
  console.log("tenants error:", tenantsRes.error?.message ?? "(none)");
  console.log("tenants count:", tenantsRes.data?.length ?? 0);

  const tenantIds = (tenantsRes.data ?? []).map((t) => t.id);
  const subsRes = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, customer_id, product_id, subscription_status, trial_end_date, created_at, billing_waived, billing_waived_reason, billing_waived_by, billing_waived_at, custom_price_ghs, custom_price_reason, custom_price_set_by, custom_price_set_at",
    )
    .in("linked_tenant_id", tenantIds)
    .order("created_at", { ascending: false });
  console.log("subscriptions error:", subsRes.error?.message ?? "(none)");
  console.log("subscriptions count:", subsRes.data?.length ?? 0);

  const productsRes = await admin
    .from("crm_products")
    .select(
      "id, name, product_type, unit_price, price_ghs, billing_cycle, is_active, category, business_unit_id",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("category", "ERP Suite")
    .order("name", { ascending: true });
  console.log("tier products error:", productsRes.error?.message ?? "(none)");
  console.log("tier products count:", productsRes.data?.length ?? 0);

  console.log("\n=== 2. Legacy embed query (pre-fix page load path) ===");
  const legacySubsRes = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, product_id, product:crm_products(name)",
    )
    .in("linked_tenant_id", tenantIds)
    .limit(5);
  console.log("legacy embed error:", legacySubsRes.error?.message ?? "(none)");

  console.log("\n=== 3. Simulate custom-price UPDATE with email in custom_price_set_by ===");
  const davidCustomerSub = await admin
    .from("crm_subscriptions")
    .select("id, linked_tenant_id, customer_id, custom_price_set_by")
    .limit(1)
    .maybeSingle();
  if (davidCustomerSub.data?.id) {
    const trialUpdate = await admin
      .from("crm_subscriptions")
      .update({ custom_price_set_by: TARGET_EMAIL })
      .eq("id", davidCustomerSub.data.id)
      .select("id")
      .maybeSingle();
    console.log(
      "trial UPDATE custom_price_set_by=email error:",
      trialUpdate.error?.message ?? "(none)",
    );
    if (!trialUpdate.error) {
      await admin
        .from("crm_subscriptions")
        .update({ custom_price_set_by: null })
        .eq("id", davidCustomerSub.data.id);
    }
  }

  console.log("\n=== 4. Postgres: column types on crm_subscriptions audit fields ===");
  const { client: pg } = await connectPg({ requiredProjectRef: "wieflwbfdmjtsdnwbfii" });
  try {
    const typeRes = await pg.query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'crm_subscriptions'
         AND column_name IN (
           'linked_tenant_id', 'product_id', 'customer_id',
           'billing_waived_by', 'custom_price_set_by', 'tenant_id'
         )
       ORDER BY column_name`,
    );
    console.table(typeRes.rows);

    console.log("\n=== 5. Search for literal email in crm_subscriptions text/uuid columns ===");
    const emailLikeRes = await pg.query(
      `SELECT id, linked_tenant_id::text, customer_id, product_id::text,
              billing_waived_by::text, custom_price_set_by::text,
              custom_price_reason, billing_waived_reason
       FROM crm_subscriptions
       WHERE linked_tenant_id::text ILIKE $1
          OR customer_id ILIKE $1
          OR product_id::text ILIKE $1
          OR billing_waived_by::text ILIKE $1
          OR custom_price_set_by::text ILIKE $1
       LIMIT 20`,
      [`%${TARGET_EMAIL}%`],
    );
    console.log("crm_subscriptions matches:", emailLikeRes.rowCount);
    if (emailLikeRes.rows.length) console.table(emailLikeRes.rows);

    console.log("\n=== 6. Rows where linked_tenant_id fails uuid cast ===");
    const badLinkedRes = await pg.query(
      `SELECT id, linked_tenant_id::text AS linked_tenant_id,
              customer_id, product_id::text AS product_id
       FROM crm_subscriptions
       WHERE linked_tenant_id IS NOT NULL
         AND linked_tenant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       LIMIT 20`,
    );
    console.log("invalid linked_tenant_id rows:", badLinkedRes.rowCount);
    if (badLinkedRes.rows.length) console.table(badLinkedRes.rows);

    console.log("\n=== 7. Rows where product_id fails uuid cast ===");
    const badProductRes = await pg.query(
      `SELECT id, linked_tenant_id::text, product_id::text AS product_id, customer_id
       FROM crm_subscriptions
       WHERE product_id IS NOT NULL
         AND product_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       LIMIT 20`,
    );
    console.log("invalid product_id rows:", badProductRes.rowCount);
    if (badProductRes.rows.length) console.table(badProductRes.rows);

    console.log("\n=== 8. customers.email = target (contact email display path) ===");
    const customerRes = await pg.query(
      `SELECT client_id, email, tenant_id::text, client_name, source
       FROM customers
       WHERE email ILIKE $1
       LIMIT 20`,
      [TARGET_EMAIL],
    );
    console.log("customer rows with that email:", customerRes.rowCount);
    if (customerRes.rows.length) console.table(customerRes.rows);

    const subForDavid = await pg.query(
      `SELECT cs.id, cs.linked_tenant_id::text, cs.custom_price_set_by::text,
              cs.billing_waived_by::text, c.email AS customer_email, c.client_id
       FROM crm_subscriptions cs
       LEFT JOIN customers c ON c.client_id = cs.customer_id
       WHERE c.email ILIKE $1
       ORDER BY cs.created_at DESC
       LIMIT 5`,
      [TARGET_EMAIL],
    );
    console.log("\n=== 9. Subscriptions linked to customer email david.avors@gmail.com ===");
    console.log("count:", subForDavid.rowCount);
    if (subForDavid.rows.length) console.table(subForDavid.rows);

    if (subForDavid.rows[0]?.id) {
      for (const col of ["custom_price_set_by", "billing_waived_by"] as const) {
        try {
          await pg.query(
            `UPDATE crm_subscriptions SET ${col} = $1 WHERE id = $2`,
            [TARGET_EMAIL, subForDavid.rows[0].id],
          );
          console.log(`UPDATE ${col} with email: SUCCESS (text column)`);
          await pg.query(
            `UPDATE crm_subscriptions SET ${col} = NULL WHERE id = $1`,
            [subForDavid.rows[0].id],
          );
        } catch (err) {
          console.log(
            `UPDATE ${col} with email: FAILED ->`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
