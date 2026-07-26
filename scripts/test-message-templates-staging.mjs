/**
 * Staging smoke test for message_templates API validation + soft delete.
 * Requires a logged-in session cookie OR uses service role to exercise table
 * constraints / soft-delete semantics directly, plus unit validation.
 *
 * Usage: node scripts/test-message-templates-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

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

// Mirror of validateMessageTemplateInput (utils/message-templates-types.ts)
function validateMessageTemplateInput(body) {
  const name = body.name?.trim() ?? "";
  if (!name) return "Template name is required.";
  const templateType = body.template_type?.trim() ?? "";
  if (!["marketing", "transactional"].includes(templateType)) {
    return "Type must be marketing or transactional.";
  }
  const channel = body.channel?.trim() ?? "";
  if (!["email", "sms", "both"].includes(channel)) {
    return "Channel must be email, sms, or both.";
  }
  const subject = body.subject?.trim() ?? "";
  const bodyEmail = body.body_email?.trim() ?? "";
  const bodySms = body.body_sms?.trim() ?? "";
  if (channel === "email" || channel === "both") {
    if (!subject) return "Subject is required for email templates.";
    if (!bodyEmail) return "Email body is required when channel includes email.";
  }
  if ((channel === "sms" || channel === "both") && !bodySms) {
    return "SMS body is required when channel includes SMS.";
  }
  return null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const invalid = validateMessageTemplateInput({
  name: "Bad",
  template_type: "marketing",
  channel: "email",
  subject: "Hi",
  body_email: "",
  body_sms: "sms only filled",
});
assert(
  invalid === "Email body is required when channel includes email.",
  `Expected friendly validation, got: ${invalid}`,
);
console.log("OK client validation blocks email channel without body_email");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const inserts = [
  {
    tenant_id: DAVORS,
    name: `Smoke Marketing Email ${stamp}`,
    template_type: "marketing",
    channel: "email",
    subject: "Welcome",
    body_email: "Hello {{customer_name}}",
    body_sms: null,
    variables: ["customer_name"],
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Smoke Transactional SMS ${stamp}`,
    template_type: "transactional",
    channel: "sms",
    subject: null,
    body_email: null,
    body_sms: "Code {{otp}}",
    variables: ["otp"],
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Smoke Marketing Both ${stamp}`,
    template_type: "marketing",
    channel: "both",
    subject: "Promo",
    body_email: "Email {{customer_name}}",
    body_sms: "SMS {{customer_name}}",
    variables: ["customer_name"],
    is_active: true,
  },
];

const { data: created, error: createError } = await admin
  .from("message_templates")
  .insert(inserts)
  .select("id, name, channel, is_active");

assert(!createError, `create failed: ${createError?.message}`);
assert(created?.length === 3, `expected 3 rows, got ${created?.length}`);
console.log("OK created 3 templates:", created.map((r) => r.channel).join(", "));

// DB constraint should reject email without body_email
const { error: badInsertError } = await admin.from("message_templates").insert({
  tenant_id: DAVORS,
  name: `Smoke Invalid ${stamp}`,
  template_type: "marketing",
  channel: "email",
  subject: "x",
  body_email: null,
  body_sms: "filled but irrelevant",
  variables: [],
  is_active: true,
});
assert(Boolean(badInsertError), "expected DB check constraint to reject invalid row");
console.log("OK DB rejects invalid email/body combo:", badInsertError.message);

const deactivateId = created[0].id;
const { error: softError } = await admin
  .from("message_templates")
  .update({ is_active: false })
  .eq("id", deactivateId)
  .eq("tenant_id", DAVORS);
assert(!softError, softError?.message);

const { data: activeList } = await admin
  .from("message_templates")
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
  .from("message_templates")
  .select("id, is_active")
  .eq("id", deactivateId)
  .maybeSingle();
assert(stillThere?.is_active === false, "row should still exist as inactive");
console.log("OK soft delete: hidden from active list, row retained");

// Cleanup smoke rows
await admin
  .from("message_templates")
  .delete()
  .in(
    "id",
    created.map((r) => r.id),
  );
console.log("OK cleaned smoke rows");
void resolveDatabaseUrl;
console.log("DONE");
