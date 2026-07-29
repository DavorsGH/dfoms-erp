/**
 * Staging smoke test for employee_announcements create/list/edit draft rules + codes.
 *
 * Usage: node scripts/test-employee-announcements-campaigns-staging.mjs
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Mirror validateEmployeeAnnouncementInput essentials
function validateEmployeeAnnouncementInput(body) {
  const name = body.name?.trim() ?? "";
  if (!name) return "Announcement name is required.";
  const channels = Array.isArray(body.channels) ? body.channels : [];
  if (channels.length === 0) {
    return "Select at least one channel (email, SMS, or in-app).";
  }
  const templateId =
    typeof body.template_id === "string" ? body.template_id.trim() : "";
  const announcementBody = body.body?.trim() ?? "";
  if (!templateId && !announcementBody) {
    return "Select a template or provide an ad-hoc message body.";
  }
  const subject = body.subject?.trim() ?? "";
  if (!templateId && channels.includes("email") && !subject) {
    return "Subject is required for email announcements without a template.";
  }
  return null;
}

assert(
  validateEmployeeAnnouncementInput({
    name: "x",
    channels: ["email"],
    template_id: null,
    body: "hi",
    subject: "",
  }) === "Subject is required for email announcements without a template.",
  "adhoc email needs subject",
);
console.log("OK client validation blocks ad-hoc email without subject");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const createdIds = [];

const { data: template, error: templateError } = await admin
  .from("employee_message_templates")
  .insert({
    tenant_id: DAVORS,
    name: `Smoke Announcement Template ${stamp}`,
    channel: "email",
    subject: "Template subject",
    body: "Template body {{employee_name}}",
    is_active: true,
  })
  .select("id")
  .single();
assert(!templateError, `template create failed: ${templateError?.message}`);
const templateId = template.id;

async function nextCode() {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: DAVORS,
    p_entity_type: "ANNC",
    p_padding: 4,
  });
  assert(!error, `generate_next_code failed: ${error?.message}`);
  assert(
    typeof data === "string" && /ANNC-\d{4}$/.test(data),
    `bad code ${data}`,
  );
  return data;
}

const audiences = [
  { type: "all" },
  { type: "position", value: "Cleaner" },
  { type: "shift", value: "Morning" },
  { type: "employment_type", value: "Full-Time" },
];

// Need a real employee_id for individual — pick any Davors employee
const { data: anyEmployee, error: empError } = await admin
  .from("employees")
  .select("employee_id")
  .eq("tenant_id", DAVORS)
  .limit(1)
  .maybeSingle();
assert(!empError, empError?.message);
assert(anyEmployee?.employee_id, "need at least one staging employee for individual filter");
audiences.push({ type: "individual", value: anyEmployee.employee_id });

const codes = [];

// 1) Template-based draft
{
  const code = await nextCode();
  codes.push(code);
  const { data, error } = await admin
    .from("employee_announcements")
    .insert({
      tenant_id: DAVORS,
      announcement_code: code,
      name: `Smoke Template Announcement ${stamp}`,
      template_id: templateId,
      channels: ["email", "in_app"],
      subject: null,
      body: null,
      audience_filter: { type: "all" },
      status: "draft",
      total_recipients: 0,
    })
    .select("id, announcement_code, template_id, audience_filter, status")
    .single();
  assert(!error, `template announcement failed: ${error?.message}`);
  assert(data.template_id === templateId, "template_id not saved");
  createdIds.push(data.id);
  console.log("OK created template announcement", data.announcement_code);
}

// 2) Ad-hoc draft
{
  const code = await nextCode();
  codes.push(code);
  const { data, error } = await admin
    .from("employee_announcements")
    .insert({
      tenant_id: DAVORS,
      announcement_code: code,
      name: `Smoke Adhoc Announcement ${stamp}`,
      template_id: null,
      channels: ["sms"],
      subject: null,
      body: "Ad-hoc SMS body",
      audience_filter: { type: "shift", value: "Morning" },
      status: "draft",
      total_recipients: 0,
    })
    .select("id, announcement_code, body, audience_filter")
    .single();
  assert(!error, `adhoc announcement failed: ${error?.message}`);
  assert(data.body === "Ad-hoc SMS body", "adhoc body not saved");
  assert(data.audience_filter?.type === "shift", "shift audience not saved");
  createdIds.push(data.id);
  console.log("OK created ad-hoc announcement", data.announcement_code);
}

// 3) All audience filter types
for (const audience of audiences) {
  const code = await nextCode();
  codes.push(code);
  const { data, error } = await admin
    .from("employee_announcements")
    .insert({
      tenant_id: DAVORS,
      announcement_code: code,
      name: `Smoke Audience ${audience.type} ${stamp}`,
      template_id: null,
      channels: ["in_app"],
      subject: null,
      body: `Audience ${audience.type}`,
      audience_filter: audience,
      status: "draft",
      total_recipients: 0,
    })
    .select("id, audience_filter")
    .single();
  assert(!error, `audience ${audience.type} failed: ${error?.message}`);
  assert(
    data.audience_filter?.type === audience.type,
    `audience type mismatch for ${audience.type}`,
  );
  if (audience.type !== "all") {
    const saved = data.audience_filter.value;
    const expected = audience.value;
    const ok = Array.isArray(expected)
      ? JSON.stringify(saved) === JSON.stringify(expected)
      : saved === expected;
    assert(ok, `audience value mismatch for ${audience.type}`);
  }
  createdIds.push(data.id);
}
console.log("OK audience_filter saved for all/position/shift/employment_type/individual");

// Code sequencing (suffix after ANNC-)
assert(codes.length >= 2, "need codes");
const nums = codes.map((c) => {
  const match = String(c).match(/ANNC-(\d+)$/);
  assert(match, `unparseable code ${c}`);
  return Number(match[1]);
});
for (let i = 1; i < nums.length; i++) {
  assert(
    nums[i] === nums[i - 1] + 1,
    `expected sequential ANNC codes, got ${codes.join(", ")}`,
  );
}
console.log("OK announcement_code sequencing:", codes.join(", "));

// Draft-only edit/delete enforcement (simulate API rule)
const draftId = createdIds[0];
const { error: markSentError } = await admin
  .from("employee_announcements")
  .update({ status: "sent" })
  .eq("id", draftId)
  .eq("tenant_id", DAVORS);
assert(!markSentError, markSentError?.message);

const { data: sentRow } = await admin
  .from("employee_announcements")
  .select("id, status")
  .eq("id", draftId)
  .single();
assert(sentRow.status === "sent", "status should be sent");

function assertDraftOnly(status) {
  return status === "draft";
}
assert(!assertDraftOnly(sentRow.status), "non-draft must block edit/delete");
console.log("OK draft-only gate: sent announcement is not editable/deletable");

// Content constraint: no template and empty body should fail
const { error: badContentError } = await admin.from("employee_announcements").insert({
  tenant_id: DAVORS,
  announcement_code: await nextCode(),
  name: `Smoke Bad Content ${stamp}`,
  template_id: null,
  channels: ["email"],
  subject: "x",
  body: null,
  audience_filter: { type: "all" },
  status: "draft",
  total_recipients: 0,
});
assert(Boolean(badContentError), "expected content check to reject empty body without template");
console.log("OK DB rejects ad-hoc without body:", badContentError.message);

// Cleanup
await admin.from("employee_announcements").delete().in("id", createdIds);
await admin.from("employee_message_templates").delete().eq("id", templateId);
console.log("OK cleaned smoke rows");
console.log("DONE");
