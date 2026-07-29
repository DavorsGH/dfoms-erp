/**
 * Staging smoke test for employee_message_templates validation + soft delete.
 * Mirrors scripts/test-message-templates-staging.mjs for the HR announcements table.
 *
 * Usage: node scripts/test-employee-message-templates-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const projectRef = new URL(url).hostname.split(".")[0];
if (projectRef !== "wieflwbfdmjtsdnwbfii") {
  throw new Error(`REFUSING: expected staging, got ${projectRef}`);
}
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

const DAVORS = "00000001-0000-4000-8000-000000000001";

// Mirror of validateEmployeeMessageTemplateInput
function validateEmployeeMessageTemplateInput(body) {
  const name = body.name?.trim() ?? "";
  if (!name) return "Template name is required.";
  const channel = body.channel?.trim() ?? "";
  if (!["email", "sms", "both"].includes(channel)) {
    return "Channel must be email, sms, or both.";
  }
  const subject = body.subject?.trim() ?? "";
  const templateBody = body.body?.trim() ?? "";
  if (!templateBody) return "Body is required.";
  if ((channel === "email" || channel === "both") && !subject) {
    return "Subject is required for email templates.";
  }
  return null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  validateEmployeeMessageTemplateInput({
    name: "Bad",
    channel: "email",
    subject: "",
    body: "Hello",
  }) === "Subject is required for email templates.",
  "client validation should require subject for email",
);
console.log("OK client validation blocks email without subject");

assert(
  validateEmployeeMessageTemplateInput({
    name: "Bad",
    channel: "both",
    subject: "Hi",
    body: "",
  }) === "Body is required.",
  "client validation should require body",
);
console.log("OK client validation blocks empty body");

assert(
  validateEmployeeMessageTemplateInput({
    name: "Bad",
    channel: "fax",
    subject: "Hi",
    body: "Hello",
  }) === "Channel must be email, sms, or both.",
  "client validation should reject invalid channel",
);
console.log("OK client validation blocks invalid channel");

assert(
  validateEmployeeMessageTemplateInput({
    name: "SMS ok",
    channel: "sms",
    subject: "ignored",
    body: "Payroll is ready",
  }) === null,
  "SMS should not require subject",
);
console.log("OK client validation allows SMS without subject");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const inserts = [
  {
    tenant_id: DAVORS,
    name: `Smoke Emp Email ${stamp}`,
    channel: "email",
    subject: "Welcome aboard",
    body: "Hello {{employee_name}}",
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Smoke Emp SMS ${stamp}`,
    channel: "sms",
    subject: null,
    body: "Your payslip is ready",
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Smoke Emp Both ${stamp}`,
    channel: "both",
    subject: "Company update",
    body: "Please read this announcement",
    is_active: true,
  },
];

const { data: created, error: createError } = await admin
  .from("employee_message_templates")
  .insert(inserts)
  .select("id, name, channel, subject, is_active");

assert(!createError, `create failed: ${createError?.message}`);
assert(created?.length === 3, `expected 3 rows, got ${created?.length}`);
console.log(
  "OK created 3 templates:",
  created.map((r) => r.channel).join(", "),
);

// API-layer equivalent: email without subject should be rejected by app validation.
// DB CHECK allows null subject for email, so exercise empty-string rejection instead.
const { error: emptySubjectError } = await admin
  .from("employee_message_templates")
  .insert({
    tenant_id: DAVORS,
    name: `Smoke Emp Empty Subject ${stamp}`,
    channel: "email",
    subject: "   ",
    body: "Hello",
    is_active: true,
  });
assert(
  Boolean(emptySubjectError),
  "expected DB check to reject whitespace-only subject for email",
);
console.log(
  "OK DB rejects whitespace-only subject for email:",
  emptySubjectError.message,
);

const { error: badChannelError } = await admin
  .from("employee_message_templates")
  .insert({
    tenant_id: DAVORS,
    name: `Smoke Emp Bad Channel ${stamp}`,
    channel: "fax",
    subject: "x",
    body: "Hello",
    is_active: true,
  });
assert(Boolean(badChannelError), "expected DB to reject invalid channel");
console.log("OK DB rejects invalid channel:", badChannelError.message);

const deactivateId = created[0].id;
const { error: softError } = await admin
  .from("employee_message_templates")
  .update({ is_active: false })
  .eq("id", deactivateId)
  .eq("tenant_id", DAVORS);
assert(!softError, softError?.message);

const { data: activeList } = await admin
  .from("employee_message_templates")
  .select("id")
  .eq("tenant_id", DAVORS)
  .eq("is_active", true)
  .in(
    "id",
    created.map((r) => r.id),
  );
assert(
  (activeList ?? []).every((r) => r.id !== deactivateId),
  "deactivated row should not appear in active list",
);

const { data: stillThere } = await admin
  .from("employee_message_templates")
  .select("id, is_active")
  .eq("id", deactivateId)
  .maybeSingle();
assert(stillThere?.is_active === false, "row should still exist as inactive");
console.log("OK soft delete: hidden from active list, row retained");

await admin
  .from("employee_message_templates")
  .delete()
  .in(
    "id",
    created.map((r) => r.id),
  );
console.log("OK cleaned smoke rows");
console.log("DONE");
