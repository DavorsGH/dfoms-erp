/**
 * Staging smoke: draft service contract Admin/Director SMS path (no server-only imports).
 * Usage: npx tsx scripts/test-draft-service-contract-sms-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

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

function rebuildUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

function buildPgCandidates(rawUrl: string | undefined, supabaseUrl: string) {
  const candidates: string[] = [];
  if (rawUrl) {
    candidates.push(rawUrl, rebuildUrl(rawUrl));
  }
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    candidates.push(
      `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeGhanaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233") && digits.length >= 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

async function connectPg(): Promise<pg.Client | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  for (const connectionString of buildPgCandidates(
    process.env.DATABASE_URL,
    supabaseUrl,
  )) {
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      return client;
    } catch {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function sendHubtelTestSms(to: string, content: string) {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  const from = (process.env.HUBTEL_SMS_FROM ?? "").trim() || "DAVORS";
  if (!clientId || !clientSecret) {
    throw new Error("HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET missing in env");
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://sms.hubtel.com/v1/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ From: from, To: to, Content: content }),
  });
  const bodyText = await response.text();
  let parsed: { status?: number | string; statusDescription?: string; MessageId?: string } | null =
    null;
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    parsed = null;
  }
  const hubtelStatus =
    typeof parsed?.status === "number"
      ? parsed.status
      : typeof parsed?.status === "string" && /^\d+$/.test(parsed.status)
        ? Number(parsed.status)
        : null;
  const httpOk = response.status === 200 || response.status === 201;
  if (!httpOk || hubtelStatus !== 0) {
    throw new Error(
      parsed?.statusDescription ||
        bodyText ||
        `Hubtel failed HTTP ${response.status} status=${hubtelStatus ?? "n/a"}`,
    );
  }
  return parsed?.MessageId ?? null;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

  const tier2Src = readFileSync(
    resolve(process.cwd(), "utils/tenant-admin-director-tier2-notifications.ts"),
    "utf8",
  );
  if (!tier2Src.includes("notifyTenantAdminsAndDirectorsSms")) {
    throw new Error("draft service contract notify missing SMS call");
  }
  console.log("PASS source: notifyAdminsDirectorsDraftServiceContractInvoice calls SMS");

  const creditSrc = readFileSync(
    resolve(process.cwd(), "utils/sms-credit.ts"),
    "utf8",
  );
  if (!creditSrc.includes("isDavorsPlatformTenant")) {
    throw new Error("sms-credit missing Davors platform bypass");
  }
  console.log("PASS source: tryDebitSmsCredit bypasses Davors platform tenant");

  const pgClient = await connectPg();
  if (!pgClient) {
    throw new Error("Could not connect to staging Postgres");
  }

  const context = `draft-service-contract-invoice/staging-test-${Date.now()}`;
  const content =
    "Staging test: draft service contract invoice SMS path. Safe to ignore.";

  try {
    const { rows: recipients } = await pgClient.query(
      `
      SELECT ua.auth_uid, ua.email, e.full_name, e.phone
      FROM public.user_accounts ua
      JOIN public.employees e
        ON e.tenant_id = ua.tenant_id
       AND e.employee_id = ua.employee_id
      WHERE ua.tenant_id = $1
        AND ua.is_active = true
        AND ua.role IN ('super_admin', 'director')
        AND e.phone IS NOT NULL
        AND btrim(e.phone) <> ''
      `,
      [DAVORS_TENANT_ID],
    );

    if (recipients.length === 0) {
      throw new Error("No Admin/Director recipients with employees.phone on staging");
    }
    console.log("Recipients:", recipients);

    const sent: Array<{ authUid: string; to: string; hubtelMessageId: string | null }> =
      [];
    for (const row of recipients) {
      const to = normalizeGhanaPhone(String(row.phone)) ?? String(row.phone);
      const hubtelMessageId = await sendHubtelTestSms(to, content);
      sent.push({
        authUid: row.auth_uid,
        to,
        hubtelMessageId,
      });
      console.log(`PASS Hubtel send → ${row.email} (${to}) id=${hubtelMessageId ?? "n/a"}`);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { error: logError } = await supabase.from("system_event_log").insert({
      event_type: "cron",
      event_name: "admin_director_sms_sent",
      status: "success",
      message: `Admin/Director SMS sent for ${context}`,
      metadata: {
        tenantId: DAVORS_TENANT_ID,
        context,
        sent,
        stagingTest: true,
      },
    });
    if (logError) {
      throw new Error(`system_event_log insert failed: ${logError.message}`);
    }

    const { data: logRows } = await supabase
      .from("system_event_log")
      .select("event_name, status, message, metadata, created_at")
      .eq("event_name", "admin_director_sms_sent")
      .contains("metadata", { context })
      .order("created_at", { ascending: false })
      .limit(1);

    console.log("system_event_log verify:", logRows);
    if (!logRows?.length) {
      throw new Error("system_event_log row not found after insert");
    }

    console.log("PASS staging draft service contract SMS path verified.");
  } finally {
    await pgClient.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
