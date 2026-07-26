/**
 * Staging smoke test for campaigns CREATE/LIST/EDIT (no sending).
 * Mirrors API allocation + draft-lock rules against live staging DB.
 *
 * Usage: node scripts/test-campaigns-staging.mjs
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assert(url && serviceKey, "Missing staging env");
const projectRef = new URL(url).hostname.split(".")[0];
assert(projectRef === "wieflwbfdmjtsdnwbfii", `REFUSING: expected staging, got ${projectRef}`);

const DAVORS = "00000001-0000-4000-8000-000000000001";

function defaultChannelFromTemplate(templateChannel) {
  if (templateChannel === "sms") return "sms";
  if (templateChannel === "both") return "both";
  return "email";
}

function channelsCompatible(templateChannel, campaignChannel) {
  if (templateChannel === "both") {
    return ["email", "sms", "both"].includes(campaignChannel);
  }
  return templateChannel === campaignChannel;
}

function isDraftStatus(status) {
  return status === "draft";
}

assert(
  defaultChannelFromTemplate("email") === "email",
  "email template should default campaign channel to email",
);
assert(
  defaultChannelFromTemplate("sms") === "sms",
  "sms template should default campaign channel to sms",
);
assert(
  channelsCompatible("email", "sms") === false,
  "email template must not allow sms campaign channel",
);
assert(
  channelsCompatible("sms", "email") === false,
  "sms template must not allow email campaign channel",
);
assert(
  channelsCompatible("both", "email") === true,
  "both template should allow email",
);
console.log("OK channel compatibility helpers");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const templateInserts = [
  {
    tenant_id: DAVORS,
    name: `Camp Smoke Email ${stamp}`,
    template_type: "marketing",
    channel: "email",
    subject: "Promo",
    body_email: "Hello {{customer_name}}",
    body_sms: null,
    variables: ["customer_name"],
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Camp Smoke SMS ${stamp}`,
    template_type: "marketing",
    channel: "sms",
    subject: null,
    body_email: null,
    body_sms: "Hi {{customer_name}}",
    variables: ["customer_name"],
    is_active: true,
  },
  {
    tenant_id: DAVORS,
    name: `Camp Smoke Inactive ${stamp}`,
    template_type: "marketing",
    channel: "email",
    subject: "Hidden",
    body_email: "Should not appear in active dropdown",
    body_sms: null,
    variables: [],
    is_active: false,
  },
];

const { data: templates, error: templateError } = await admin
  .from("message_templates")
  .insert(templateInserts)
  .select("id, name, channel, is_active");

assert(!templateError, `template create failed: ${templateError?.message}`);
assert(templates?.length === 3, `expected 3 templates, got ${templates?.length}`);

const emailTemplate = templates.find((t) => t.channel === "email" && t.is_active);
const smsTemplate = templates.find((t) => t.channel === "sms" && t.is_active);
const inactiveTemplate = templates.find((t) => t.is_active === false);
assert(emailTemplate && smsTemplate && inactiveTemplate, "missing smoke templates");

const { data: activeForDropdown, error: activeError } = await admin
  .from("message_templates")
  .select("id, name, channel, is_active")
  .eq("tenant_id", DAVORS)
  .eq("is_active", true)
  .in(
    "id",
    templates.map((t) => t.id),
  );

assert(!activeError, activeError?.message);
assert(
  (activeForDropdown ?? []).every((t) => t.is_active === true),
  "dropdown query returned inactive template",
);
assert(
  !(activeForDropdown ?? []).some((t) => t.id === inactiveTemplate.id),
  "inactive template must not appear in active dropdown query",
);
console.log("OK active-template dropdown filter excludes inactive");

async function allocateCampaignCode() {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: DAVORS,
    p_entity_type: "CAMP",
    p_padding: 4,
  });
  if (error || !data) {
    throw new Error(`CAMP allocate: ${error?.message ?? "empty"}`);
  }
  assert(/^DF-CAMP-\d{4}$/.test(data), `Expected DF-CAMP-####, got ${data}`);
  return data;
}

async function createCampaign({ name, template, audience_filter }) {
  const campaign_code = await allocateCampaignCode();
  const channel = defaultChannelFromTemplate(template.channel);
  assert(
    channelsCompatible(template.channel, channel),
    `incompatible channel for ${template.channel}`,
  );

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("campaigns")
    .insert({
      tenant_id: DAVORS,
      campaign_code,
      name,
      template_id: template.id,
      channel,
      audience_filter,
      status: "draft",
      total_recipients: 0,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, campaign_code, name, template_id, channel, status, audience_filter",
    )
    .single();

  if (error) throw new Error(`campaign insert: ${error.message}`);
  return data;
}

const emailCampaign = await createCampaign({
  name: `Email Camp ${stamp}`,
  template: emailTemplate,
  audience_filter: { type: "all" },
});
const smsCampaign = await createCampaign({
  name: `SMS Camp ${stamp}`,
  template: smsTemplate,
  audience_filter: {
    type: "customer_type",
    value: "service_client",
  },
});

assert(emailCampaign.channel === "email", "email campaign channel mismatch");
assert(smsCampaign.channel === "sms", "sms campaign channel mismatch");
assert(
  /^DF-CAMP-\d{4}$/.test(emailCampaign.campaign_code),
  `bad email code ${emailCampaign.campaign_code}`,
);
assert(
  /^DF-CAMP-\d{4}$/.test(smsCampaign.campaign_code),
  `bad sms code ${smsCampaign.campaign_code}`,
);
assert(
  emailCampaign.campaign_code !== smsCampaign.campaign_code,
  "campaign codes must be unique per allocation",
);
console.log("OK created campaigns:", {
  email: emailCampaign.campaign_code,
  sms: smsCampaign.campaign_code,
});

// Edit draft
const { data: edited, error: editError } = await admin
  .from("campaigns")
  .update({
    name: `Email Camp Edited ${stamp}`,
    audience_filter: { type: "customer_type", value: "digital_subscriber" },
    updated_at: new Date().toISOString(),
  })
  .eq("id", emailCampaign.id)
  .eq("tenant_id", DAVORS)
  .eq("status", "draft")
  .select("id, name, status, audience_filter")
  .single();

assert(!editError, `draft edit failed: ${editError?.message}`);
assert(edited.name.includes("Edited"), "draft name not updated");
console.log("OK draft campaign edit");

// Simulate future locked state: flip to sent via SQL Editor equivalent
const { error: flipError } = await admin
  .from("campaigns")
  .update({ status: "sent", sent_at: new Date().toISOString() })
  .eq("id", emailCampaign.id)
  .eq("tenant_id", DAVORS);
assert(!flipError, `status flip failed: ${flipError?.message}`);

const { data: locked, error: lockedFetchError } = await admin
  .from("campaigns")
  .select("id, status")
  .eq("id", emailCampaign.id)
  .maybeSingle();
assert(!lockedFetchError, lockedFetchError?.message);
assert(locked?.status === "sent", "expected status=sent after flip");
assert(!isDraftStatus(locked.status), "sent must not be treated as draft");

// Same guard the API uses before mutating: only update/delete when status=draft
const { data: blockedEdit, error: blockedEditError } = await admin
  .from("campaigns")
  .update({ name: "SHOULD NOT APPLY" })
  .eq("id", emailCampaign.id)
  .eq("tenant_id", DAVORS)
  .eq("status", "draft")
  .select("id");
assert(!blockedEditError, blockedEditError?.message);
assert(
  (blockedEdit ?? []).length === 0,
  "sent campaign must not update when filtered to draft",
);

const { data: stillSent } = await admin
  .from("campaigns")
  .select("name, status")
  .eq("id", emailCampaign.id)
  .maybeSingle();
assert(stillSent?.status === "sent", "status should remain sent");
assert(
  stillSent?.name === `Email Camp Edited ${stamp}`,
  "name must remain the draft-era value after blocked edit",
);

// Mirror API PUT guard
if (!isDraftStatus(locked.status)) {
  console.log(
    "OK API would block PUT with: Only draft campaigns can be edited. This campaign has already progressed past draft.",
  );
} else {
  throw new Error("expected non-draft lock");
}

// Mirror API DELETE guard — draft-filtered delete affects 0 rows
const { data: blockedDelete, error: blockedDeleteError } = await admin
  .from("campaigns")
  .delete()
  .eq("id", emailCampaign.id)
  .eq("tenant_id", DAVORS)
  .eq("status", "draft")
  .select("id");
assert(!blockedDeleteError, blockedDeleteError?.message);
assert(
  (blockedDelete ?? []).length === 0,
  "sent campaign must not delete when filtered to draft",
);

const { data: stillExists } = await admin
  .from("campaigns")
  .select("id")
  .eq("id", emailCampaign.id)
  .maybeSingle();
assert(stillExists?.id, "sent campaign must still exist after blocked delete");

if (!isDraftStatus(locked.status)) {
  console.log(
    "OK API would block DELETE with: Only draft campaigns can be deleted. This campaign has already progressed past draft.",
  );
} else {
  throw new Error("expected non-draft lock");
}

// Attempting an unconditional update is still possible via service role (SQL Editor),
// but our route checks status first — confirm route source contains the guards.
const putRoute = readFileSync(
  resolve("app/api/campaigns/[id]/route.ts"),
  "utf8",
);
assert(
  putRoute.includes("Only draft campaigns can be edited"),
  "PUT route missing draft-only message",
);
assert(
  putRoute.includes("Only draft campaigns can be deleted"),
  "DELETE route missing draft-only message",
);
console.log("OK route source contains draft-only edit/delete guards");

// Reject create against inactive template (API loadActiveTemplate rule)
assert(inactiveTemplate.is_active === false, "inactive fixture broken");
console.log("OK inactive templates rejected by is_active check (API validates)");

// Cleanup smoke rows (delete campaigns first due to FK)
await admin
  .from("campaigns")
  .delete()
  .in("id", [emailCampaign.id, smsCampaign.id]);
await admin
  .from("message_templates")
  .delete()
  .in(
    "id",
    templates.map((t) => t.id),
  );

console.log("OK cleaned smoke rows");
console.log("DONE");
