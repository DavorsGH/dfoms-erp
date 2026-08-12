/**
 * Phase 1 foundation test: render a client invoice PDF server-side and email it via Resend.
 *
 *   npx tsx scripts/test-client-invoice-pdf-email-production.ts --env-file .env.vercel.production.local
 *   npx tsx scripts/test-client-invoice-pdf-email-production.ts --env-file .env.vercel.production.local --to david.avors@gmail.com
 *   npx tsx scripts/test-client-invoice-pdf-email-production.ts --env-file .env.vercel.production.local --invoice-id <uuid>
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";
const DEFAULT_TO = "david.avors@gmail.com";

function loadEnvForce(filePath) {
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

function validateSupabaseEnv(envFile) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const looksPlaceholder =
    url.length < 20 ||
    !url.includes("supabase.co") ||
    /^[*x]+$/i.test(url.replace(/["']/g, ""));
  if (looksPlaceholder) {
    throw new Error(
      `${envFile} has an invalid or redacted NEXT_PUBLIC_SUPABASE_URL (length=${url.length}). Re-pull production env with \`vercel env pull .env.vercel.production.local --environment=production\`, or use .env.local.backup if that holds real credentials.`,
    );
  }
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  const envFile = argValue("--env-file") ?? ".env.vercel.production.local";
  const dryRun = process.argv.includes("--dry-run");
  loadEnvForce(resolve(envFile));
  validateSupabaseEnv(envFile);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing Supabase URL or service role key in env file.");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const to = (argValue("--to") ?? DEFAULT_TO).trim();
  let invoiceId = argValue("--invoice-id")?.trim() ?? "";

  if (!invoiceId) {
    const { data, error } = await admin
      .from("client_invoices")
      .select("id, invoice_number, status")
      .eq("tenant_id", DAVORS)
      .neq("status", "draft")
      .order("invoice_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Invoice lookup failed: ${error.message}`);
    }
    if (!data?.id) {
      throw new Error("No non-draft client_invoices row found for Davors tenant.");
    }
    invoiceId = data.id;
    console.log(
      `Using latest invoice: ${data.invoice_number} (${data.id}, status=${data.status})`,
    );
  }

  const { renderClientInvoicePdfBuffer } = await import(
    "../utils/client-invoice-pdf-server.tsx"
  );
  const { sendResendEmail } = await import("../utils/resend-email.ts");

  const { data: tenantMedia, error: tenantMediaError } = await admin
    .from("tenants")
    .select("logo_url, signature_url")
    .eq("id", DAVORS)
    .maybeSingle();

  if (tenantMediaError) {
    throw new Error(`Tenant media lookup failed: ${tenantMediaError.message}`);
  }

  console.log("Tenant media for PDF render:", {
    logo_url: tenantMedia?.logo_url ?? null,
    signature_url: tenantMedia?.signature_url ?? null,
    pathsDistinct:
      !tenantMedia?.logo_url?.trim() ||
      tenantMedia.logo_url.trim() !== (tenantMedia?.signature_url?.trim() ?? ""),
  });

  const rendered = await renderClientInvoicePdfBuffer({
    supabase: admin,
    tenantId: DAVORS,
    invoiceId,
  });

  if (!rendered.ok) {
    throw new Error(rendered.error);
  }

  const outPath = resolve(
    `scripts/_phase1-test-${rendered.invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf`,
  );
  writeFileSync(outPath, rendered.buffer);
  console.log(`Wrote local PDF copy: ${outPath} (${rendered.buffer.length} bytes)`);

  if (dryRun) {
    console.log("Dry run — skipping Resend email send.");
    return;
  }

  if (!(process.env.RESEND_API_KEY ?? "").trim()) {
    throw new Error("RESEND_API_KEY is not configured in env file.");
  }

  const subject = `[Phase 1 retest v2] Client Invoice ${rendered.invoiceNumber} PDF attachment`;
  const html = `<p>This is a Phase 1 foundation test email with the server-rendered client invoice PDF attached.</p><p>Invoice: <strong>${rendered.invoiceNumber}</strong></p>`;
  const text = `Phase 1 test: server-rendered client invoice PDF attached (${rendered.invoiceNumber}).`;

  const result = await sendResendEmail({
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: `${rendered.invoiceNumber}.pdf`,
        content: rendered.buffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (!result.ok) {
    throw new Error(`Resend failed: ${result.error}`);
  }

  console.log(`Email sent to ${to}. Resend id: ${result.id ?? "(none)"}`);
  console.log("Phase 1 end-to-end test completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
