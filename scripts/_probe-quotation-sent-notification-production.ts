/**
 * Production probe: quotation_sent notification path (read + simulate PUT transition).
 *
 * Usage: npx tsx scripts/_probe-quotation-sent-notification-production.ts [--fire]
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  const fire = process.argv.includes("--fire");
  loadEnvForce(resolve(".env.local.backup"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
    throw new Error("Refusing non-production env");
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tenantId = DAVORS;
  console.log("Davors tenant_id:", tenantId);

  const { rows: columns } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name IN (
        'ship_to_name', 'ship_to_address', 'ship_to_phone',
        'internal_notes', 'payment_terms'
      )
    ORDER BY column_name
  `);
  console.log(
    "Migration 217 columns:",
    columns.map((r) => r.column_name).join(", ") || "(none)",
  );

  const { rows: drafts } = await client.query(
    `
    SELECT id, quotation_number, status, client_id, bill_to_name, total_amount_due, valid_until, updated_at
    FROM public.client_quotations
    WHERE tenant_id = $1 AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 5
    `,
    [tenantId],
  );
  const { rows: allQuotes } = await client.query(
    `
    SELECT quotation_number, status, updated_at
    FROM public.client_quotations
    WHERE tenant_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
    `,
    [tenantId],
  );
  console.log(`All quotations (latest ${allQuotes.length}):`);
  for (const row of allQuotes) {
    console.log(`  ${row.quotation_number} status=${row.status} updated=${row.updated_at}`);
  }
  console.log(`Draft quotations (${drafts.length}):`);
  for (const row of drafts) {
    console.log(`  ${row.quotation_number} id=${row.id} client=${row.client_id}`);
  }

  const { rows: rules } = await client.query(
    `
    SELECT event_type, channel, is_active, template_id
    FROM public.transactional_notification_rules
    WHERE tenant_id = $1 AND event_type = 'quotation_sent'
    `,
    [tenantId],
  );
  console.log("quotation_sent rules:", rules);

  const target = drafts[0] ?? allQuotes[0]
    ? (
        await client.query(
          `
          SELECT id, quotation_number, status, client_id, bill_to_name, total_amount_due, valid_until
          FROM public.client_quotations
          WHERE tenant_id = $1
          ORDER BY updated_at DESC
          LIMIT 1
          `,
          [tenantId],
        )
      ).rows[0]
    : null;
  if (!target) {
    console.log("No quotation to probe.");
    await client.end();
    return;
  }
  console.log(`Probe target: ${target.quotation_number} (status=${target.status})`);

  const { shouldFireQuotationSentNotification } = await import(
    "../utils/client-document-notifications.ts"
  );
  const wouldFire = shouldFireQuotationSentNotification("draft", "sent");
  console.log(
    `\nshouldFireQuotationSentNotification('draft','sent') => ${wouldFire}`,
  );
  console.log(
    `wouldFire for existing->sent on ${target.quotation_number}: ${shouldFireQuotationSentNotification(target.status, "sent")}`,
  );

  if (!fire) {
    console.log("\nDry run only. Re-run with --fire to invoke notifyClientQuotationSent.");
    await client.end();
    return;
  }

  const { notifyClientQuotationSent } = await import(
    "../utils/client-document-notifications.ts"
  );

  console.log(`\nFiring notifyClientQuotationSent for ${target.quotation_number}...`);
  await notifyClientQuotationSent({
    tenantId,
    clientId: target.client_id,
    quotationId: target.id,
    quotationNumber: target.quotation_number,
    customerName: target.bill_to_name?.trim() || target.client_id,
    amount: String(target.total_amount_due ?? ""),
    validUntil: target.valid_until ?? "",
  });
  console.log("notifyClientQuotationSent completed without throw");

  const { rows: notifs } = await client.query(
    `
    SELECT id, title, created_at
    FROM public.client_notifications
    WHERE tenant_id = $1 AND client_id = $2
    ORDER BY created_at DESC
    LIMIT 3
    `,
    [tenantId, target.client_id],
  );
  console.log("Recent client_notifications:", notifs);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
