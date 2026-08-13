// @ts-nocheck
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";

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

function supabaseRef(url) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

async function main() {
  loadEnvForce(resolve(".env.local.backup"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log("project:", supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL));

  const { data: tenant } = await admin
    .from("tenants")
    .select("signature_url, logo_url")
    .eq("id", DAVORS)
    .maybeSingle();
  console.log("tenant signature_url present:", Boolean(tenant?.signature_url?.trim()));
  console.log("tenant logo_url present:", Boolean(tenant?.logo_url?.trim()));

  const { data: inv } = await admin
    .from("client_invoices")
    .select("id, invoice_number, status")
    .eq("tenant_id", DAVORS)
    .neq("status", "draft")
    .order("invoice_date", { ascending: false })
    .limit(3);
  console.log("invoices:", inv ?? []);

  const { data: quo } = await admin
    .from("client_quotations")
    .select("id, quotation_number, status")
    .eq("tenant_id", DAVORS)
    .eq("status", "sent")
    .order("issue_date", { ascending: false })
    .limit(3);
  console.log("quotations sent:", quo ?? []);

  const { data: rcpt } = await admin
    .from("client_receipts")
    .select("id, receipt_number")
    .eq("tenant_id", DAVORS)
    .order("receipt_date", { ascending: false })
    .limit(3);
  console.log("receipts:", rcpt ?? []);

  const { data: reg } = await admin.rpc("to_regclass", { name: "client_notifications" }).maybeSingle?.();
  // fallback direct query via raw - use from information_schema through a simple select
  const { error: cnErr } = await admin.from("client_notifications").select("id").limit(1);
  console.log("client_notifications accessible:", cnErr ? cnErr.message : "yes");
}

main().catch(console.error);
