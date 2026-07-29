/**
 * One-recipient Hubtel SMS test via employee announcement send path.
 * Targets ONLY a single employee (David) by phone match — never a blast.
 *
 * Usage:
 *   npx tsx scripts/test-hubtel-announcement-sms-one-recipient.ts --env-file .env.staging.local
 *   npx tsx scripts/test-hubtel-announcement-sms-one-recipient.ts --env-file .env.local.backup --allow-production
 *
 * Optional:
 *   --phone 0244303171
 *   --employee-id EMP...
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_PHONE = "0244303171";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };

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

function mask(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "MISSING";
  const pref = v.slice(0, Math.min(4, v.length));
  return `PRESENT (len=${v.length}, prefix=${pref}…)`;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.staging.local";
  let allowProduction = false;
  let phone = DEFAULT_PHONE;
  let employeeId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env-file") envFile = argv[++i] ?? envFile;
    else if (argv[i] === "--allow-production") allowProduction = true;
    else if (argv[i] === "--phone") phone = argv[++i] ?? phone;
    else if (argv[i] === "--employee-id") employeeId = argv[++i] ?? null;
  }
  return { envFile, allowProduction, phone, employeeId };
}

function normalizePhone(value: string): string {
  return value.replace(/[\s\-()]/g, "");
}

function phonesMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (left === right) return true;
  const leftDigits = left.replace(/\D/g, "");
  const rightDigits = right.replace(/\D/g, "");
  if (leftDigits === rightDigits) return true;
  // 024... vs 23324...
  const stripGh = (d: string) =>
    d.startsWith("233") && d.length >= 12 ? `0${d.slice(3)}` : d;
  return stripGh(leftDigits) === stripGh(rightDigits);
}

async function sendHubtelSmsRaw(to: string, content: string) {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  const from = (process.env.HUBTEL_SMS_FROM ?? "").trim() || "DAVORS";
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://sms.hubtel.com/v1/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ From: from, To: to, Content: content }),
  });
  const rawBody = await response.text().catch(() => "");
  return { httpStatus: response.status, rawBody, from };
}

async function main() {
  const { envFile, allowProduction, phone, employeeId } = parseArgs(
    process.argv.slice(2),
  );
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const projectRef = new URL(url).hostname.split(".")[0];
  const isProd = projectRef === PRODUCTION_REF;
  const isStaging = projectRef === STAGING_REF;

  assert(isProd || isStaging, `Unexpected project ref: ${projectRef}`);
  if (isProd && !allowProduction) {
    throw new Error("Production requires --allow-production");
  }
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  console.log("=== Hubtel one-recipient announcement SMS test ===");
  console.log("envFile:", envFile);
  console.log("projectRef:", projectRef);
  console.log("HUBTEL_CLIENT_ID:", mask(process.env.HUBTEL_CLIENT_ID));
  console.log("HUBTEL_CLIENT_SECRET:", mask(process.env.HUBTEL_CLIENT_SECRET));
  console.log(
    "HUBTEL_SMS_FROM:",
    (process.env.HUBTEL_SMS_FROM ?? "").trim() || "DAVORS (default)",
  );
  console.log("target phone filter:", phone);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve David's employee — by id if given, else phone match on Davors.
  let employee: {
    employee_id: string;
    staff_id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null = null;

  if (employeeId) {
    const { data, error } = await admin
      .from("employees")
      .select("employee_id, staff_id, full_name, phone, email")
      .eq("tenant_id", DAVORS)
      .eq("employee_id", employeeId)
      .maybeSingle();
    assert(!error, error?.message ?? "employee lookup failed");
    employee = data;
  } else {
    const { data, error } = await admin
      .from("employees")
      .select("employee_id, staff_id, full_name, phone, email")
      .eq("tenant_id", DAVORS)
      .not("phone", "is", null)
      .limit(500);
    assert(!error, error?.message ?? "employees list failed");
    const matches = (data ?? []).filter((row) => phonesMatch(row.phone, phone));
    assert(
      matches.length === 1,
      `Expected exactly 1 Davors employee with phone ${phone}, found ${matches.length}`,
    );
    employee = matches[0]!;
  }

  assert(employee, "Employee not found");

  const originalPhone = employee.phone;
  let phonePatched = false;
  if (!phonesMatch(employee.phone, phone)) {
    // David's EMP0001 often has null phone — set temporarily for isolated SMS only.
    const { error: phoneErr } = await admin
      .from("employees")
      .update({ phone })
      .eq("tenant_id", DAVORS)
      .eq("employee_id", employee.employee_id);
    assert(!phoneErr, phoneErr?.message ?? "temporary phone update failed");
    employee.phone = phone;
    phonePatched = true;
    console.log(
      `Temporarily set ${employee.employee_id} phone=${phone} (was ${originalPhone ?? "null"})`,
    );
  }

  console.log("Resolved employee:", {
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
    phone: employee.phone,
  });

  const stamp = Date.now();
  const cleanup = {
    announcementId: null as string | null,
    templateId: null as string | null,
  };

  try {
    const { data: template, error: tmplErr } = await admin
      .from("employee_message_templates")
      .insert({
        tenant_id: DAVORS,
        name: `Hubtel One-Recipient ${stamp}`,
        channel: "sms",
        subject: null,
        body: `DFOMS Hubtel one-recipient test ${stamp}. Hi {{employee_name}}.`,
        is_active: true,
      })
      .select("id")
      .single();
    assert(!tmplErr && template, tmplErr?.message ?? "template create failed");
    cleanup.templateId = template.id;

    const { data: code, error: codeErr } = await admin.rpc("generate_next_code", {
      p_tenant_id: DAVORS,
      p_entity_type: "ANNC",
      p_padding: 4,
    });
    assert(!codeErr && code, codeErr?.message ?? "ANNC code failed");

    const { data: announcement, error: annErr } = await admin
      .from("employee_announcements")
      .insert({
        tenant_id: DAVORS,
        announcement_code: code,
        name: `Hubtel SMS one-recipient ${stamp}`,
        template_id: template.id,
        channels: ["sms"],
        subject: null,
        body: null,
        audience_filter: {
          type: "individual",
          value: employee.employee_id,
        },
        status: "draft",
        total_recipients: 0,
      })
      .select("id, announcement_code")
      .single();
    assert(!annErr && announcement, annErr?.message ?? "announcement create failed");
    cleanup.announcementId = announcement.id;
    console.log("Created draft announcement:", announcement.announcement_code);

    const { runAnnouncementSend } = await import(
      "../utils/employee-announcement-send"
    );
    const result = await runAnnouncementSend(admin as SupabaseClient, {
      tenantId: DAVORS,
      announcementId: announcement.id,
    });
    console.log("Send result:", result);

    const { data: recipients, error: recErr } = await admin
      .from("employee_announcement_recipients")
      .select("employee_id, channel, status, error_detail, sent_at")
      .eq("announcement_id", announcement.id)
      .eq("tenant_id", DAVORS);
    assert(!recErr, recErr?.message ?? "recipients fetch failed");
    console.log("Recipient rows:", recipients);

    assert(
      (recipients ?? []).length === 1,
      `Expected exactly 1 recipient row, got ${(recipients ?? []).length}`,
    );
    const row = recipients![0]!;
    assert(row.employee_id === employee.employee_id, "wrong employee_id on recipient");
    assert(row.channel === "sms", "expected sms channel");

    if (row.status !== "sent") {
      console.log("\n=== FAILURE — capturing raw Hubtel response ===");
      const raw = await sendHubtelSmsRaw(
        employee.phone!.trim(),
        `DFOMS Hubtel diagnostic ${stamp}`,
      );
      console.log("Raw Hubtel HTTP:", raw.httpStatus);
      console.log("Raw Hubtel From:", raw.from);
      console.log("Raw Hubtel body:", raw.rawBody);
      console.log("Recipient error_detail:", row.error_detail);
      throw new Error(
        `SMS recipient status=${row.status}; error_detail=${row.error_detail ?? "n/a"}`,
      );
    }

    console.log("\nPASS: recipient status=sent for one-recipient SMS announcement");
  } finally {
    if (cleanup.announcementId) {
      await admin
        .from("employee_announcement_recipients")
        .delete()
        .eq("announcement_id", cleanup.announcementId);
      await admin
        .from("employee_notifications")
        .delete()
        .eq("announcement_id", cleanup.announcementId);
      await admin
        .from("employee_announcements")
        .delete()
        .eq("id", cleanup.announcementId);
    }
    if (cleanup.templateId) {
      await admin
        .from("employee_message_templates")
        .delete()
        .eq("id", cleanup.templateId);
    }
    if (phonePatched) {
      await admin
        .from("employees")
        .update({ phone: originalPhone })
        .eq("tenant_id", DAVORS)
        .eq("employee_id", employee.employee_id);
      console.log(
        `Restored ${employee.employee_id} phone to ${originalPhone ?? "null"}`,
      );
    }
    console.log("OK cleaned one-recipient smoke rows");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
