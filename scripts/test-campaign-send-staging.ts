/**
 * Staging smoke: campaign send + unsubscribe + batch continue.
 * Usage: npx tsx scripts/test-campaign-send-staging.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

// Next.js boundary marker — stub so Node smoke tests can import server helpers.
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
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
  if (v.length < 8) return `PRESENT (short len=${v.length})`;
  return `PRESENT (len=${v.length}, prefix=${v.slice(0, 4)}…)`;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

  const {
    processCampaignSendBatch,
    runCampaignSend,
  } = await import("../utils/campaign-send");
  const { sendHubtelSms } = await import("../utils/hubtel-sms");
  const { sendResendEmail } = await import("../utils/resend-email");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  console.log("RESEND_API_KEY:", mask(process.env.RESEND_API_KEY));
  console.log("HUBTEL_CLIENT_ID:", mask(process.env.HUBTEL_CLIENT_ID));
  console.log("HUBTEL_CLIENT_SECRET:", mask(process.env.HUBTEL_CLIENT_SECRET));
  console.log(
    "HUBTEL_SMS_FROM:",
    (process.env.HUBTEL_SMS_FROM ?? "").trim() || "(default DAVORS)",
  );

  const hubtelConfigured = Boolean(
    (process.env.HUBTEL_CLIENT_ID ?? "").trim() &&
      (process.env.HUBTEL_CLIENT_SECRET ?? "").trim(),
  );
  const resendConfigured = Boolean((process.env.RESEND_API_KEY ?? "").trim());

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const optedOutId = `CAN-OPT-${stamp}`;
  const optedInId = `CAN-IN-${stamp}`;
  const emailOnlyId = `CAN-EM-${stamp}`;

  const customerRows = [
    {
      tenant_id: CAANTA,
      client_id: optedOutId,
      client_name: `Opted Out Smoke ${stamp}`,
      email: `optout.${stamp}@example.com`,
      phone: "0244111001",
      customer_type: "service_client",
      status: "active",
    },
    {
      tenant_id: CAANTA,
      client_id: optedInId,
      client_name: `Opted In Smoke ${stamp}`,
      email: `optin.${stamp}@example.com`,
      phone: "0244111002",
      customer_type: "service_client",
      status: "active",
    },
    {
      tenant_id: CAANTA,
      client_id: emailOnlyId,
      client_name: `Email Only Smoke ${stamp}`,
      email: `emailonly.${stamp}@example.com`,
      phone: "0244111003",
      customer_type: "service_client",
      status: "active",
    },
  ];

  const { error: custErr } = await admin.from("customers").insert(customerRows);
  assert(!custErr, `customers insert: ${custErr?.message ?? "failed"}`);

  const { data: pref, error: prefErr } = await admin
    .from("customer_comm_preferences")
    .insert({
      tenant_id: CAANTA,
      customer_id: optedOutId,
      email_opt_in: true,
      sms_opt_in: false,
    })
    .select("id, unsubscribe_token, sms_opt_in")
    .single();
  assert(!prefErr && pref, `pref insert: ${prefErr?.message ?? "missing"}`);
  console.log("OK created sms_opt_in=false preference for", optedOutId);

  const { data: emailTemplate, error: emailTmplErr } = await admin
    .from("message_templates")
    .insert({
      tenant_id: CAANTA,
      name: `Send Smoke Email ${stamp}`,
      template_type: "marketing",
      channel: "email",
      subject: "Hello {{customer_name}}",
      body_email: "Hi {{customer_name}}, this is a staging smoke email.",
      body_sms: null,
      variables: ["customer_name"],
      is_active: true,
    })
    .select(
      "id, name, channel, subject, body_email, body_sms, variables, is_active",
    )
    .single();
  assert(
    !emailTmplErr && emailTemplate,
    emailTmplErr?.message ?? "email template missing",
  );

  const { data: smsTemplate, error: smsTmplErr } = await admin
    .from("message_templates")
    .insert({
      tenant_id: CAANTA,
      name: `Send Smoke SMS ${stamp}`,
      template_type: "marketing",
      channel: "sms",
      subject: null,
      body_email: null,
      body_sms: "Hi {{customer_name}}, staging smoke SMS.",
      variables: ["customer_name"],
      is_active: true,
    })
    .select(
      "id, name, channel, subject, body_email, body_sms, variables, is_active",
    )
    .single();
  assert(
    !smsTmplErr && smsTemplate,
    smsTmplErr?.message ?? "sms template missing",
  );

  async function allocateCode() {
    const { data, error } = await admin.rpc("generate_next_code", {
      p_tenant_id: CAANTA,
      p_entity_type: "CAMP",
      p_padding: 4,
    });
    assert(!error && data, error?.message ?? "empty code");
    return data as string;
  }

  const smsCode = await allocateCode();
  const { data: smsCampaign, error: smsCampErr } = await admin
    .from("campaigns")
    .insert({
      tenant_id: CAANTA,
      campaign_code: smsCode,
      name: `SMS Send Smoke ${stamp}`,
      template_id: smsTemplate.id,
      channel: "sms",
      audience_filter: { type: "all" },
      status: "draft",
      total_recipients: 0,
    })
    .select("id, status")
    .single();
  assert(!smsCampErr && smsCampaign, smsCampErr?.message ?? "sms campaign missing");

  const smsSend1 = await runCampaignSend(admin as SupabaseClient, {
    tenantId: CAANTA,
    campaignId: smsCampaign.id,
  });
  console.log("SMS send result:", smsSend1);

  const { data: smsRecipients } = await admin
    .from("campaign_recipients")
    .select("customer_id, channel, status, error")
    .eq("campaign_id", smsCampaign.id)
    .eq("tenant_id", CAANTA);

  const optedOutRow = (smsRecipients ?? []).find(
    (r) => r.customer_id === optedOutId,
  );
  assert(
    optedOutRow?.status === "skipped_opted_out",
    `expected skipped_opted_out for opted-out customer, got ${optedOutRow?.status}`,
  );
  console.log("OK opted-out SMS customer recorded as skipped_opted_out");

  const otherSms = (smsRecipients ?? []).filter(
    (r) => r.customer_id !== optedOutId,
  );
  assert(otherSms.length > 0, "expected other SMS recipients");
  for (const row of otherSms) {
    if (!hubtelConfigured) {
      assert(
        row.status === "failed",
        `without Hubtel creds expected failed, got ${row.status} for ${row.customer_id}`,
      );
      assert(
        String(row.error ?? "").includes("HUBTEL"),
        `expected Hubtel config error, got: ${row.error}`,
      );
    } else {
      assert(
        row.status === "sent" || row.status === "failed",
        `unexpected status ${row.status}`,
      );
    }
  }
  console.log(
    hubtelConfigured
      ? "OK Hubtel configured — SMS path invoked for opted-in recipients"
      : "OK Hubtel NOT configured — SMS failed per-recipient without aborting batch",
  );

  const emailCode = await allocateCode();
  const { data: emailCampaign, error: emailCampErr } = await admin
    .from("campaigns")
    .insert({
      tenant_id: CAANTA,
      campaign_code: emailCode,
      name: `Email Send Smoke ${stamp}`,
      template_id: emailTemplate.id,
      channel: "email",
      audience_filter: { type: "all" },
      status: "draft",
      total_recipients: 0,
    })
    .select("id, status")
    .single();
  assert(
    !emailCampErr && emailCampaign,
    emailCampErr?.message ?? "email campaign missing",
  );

  const emailSend1 = await runCampaignSend(admin as SupabaseClient, {
    tenantId: CAANTA,
    campaignId: emailCampaign.id,
  });
  console.log("Email send result:", emailSend1);

  const { data: emailPrefs } = await admin
    .from("customer_comm_preferences")
    .select("customer_id, unsubscribe_token, email_opt_in, unsubscribed_at")
    .eq("tenant_id", CAANTA)
    .in("customer_id", [optedInId, emailOnlyId]);

  assert(
    (emailPrefs ?? []).length >= 2,
    "expected lazy-created preferences for email recipients",
  );
  console.log("OK lazy-created customer_comm_preferences for email sends");

  const unsubTarget = (emailPrefs ?? []).find((p) => p.customer_id === optedInId);
  assert(unsubTarget?.unsubscribe_token, "missing unsubscribe token");

  const now = new Date().toISOString();
  const { error: unsubErr } = await admin
    .from("customer_comm_preferences")
    .update({
      unsubscribed_at: now,
      email_opt_in: false,
      sms_opt_in: false,
      updated_at: now,
    })
    .eq("unsubscribe_token", unsubTarget.unsubscribe_token);
  assert(!unsubErr, unsubErr?.message ?? "unsubscribe update failed");

  const { data: afterUnsub } = await admin
    .from("customer_comm_preferences")
    .select("email_opt_in, sms_opt_in, unsubscribed_at")
    .eq("unsubscribe_token", unsubTarget.unsubscribe_token)
    .maybeSingle();
  assert(afterUnsub?.unsubscribed_at, "unsubscribed_at not set");
  assert(afterUnsub?.email_opt_in === false, "email_opt_in should be false");
  assert(afterUnsub?.sms_opt_in === false, "sms_opt_in should be false");
  console.log("OK unsubscribe DB update (page/API equivalent)");

  const emailCode2 = await allocateCode();
  const { data: emailCampaign2, error: emailCamp2Err } = await admin
    .from("campaigns")
    .insert({
      tenant_id: CAANTA,
      campaign_code: emailCode2,
      name: `Email After Unsub ${stamp}`,
      template_id: emailTemplate.id,
      channel: "email",
      audience_filter: { type: "all" },
      status: "draft",
      total_recipients: 0,
    })
    .select("id")
    .single();
  assert(
    !emailCamp2Err && emailCampaign2,
    emailCamp2Err?.message ?? "email campaign 2 missing",
  );

  await runCampaignSend(admin as SupabaseClient, {
    tenantId: CAANTA,
    campaignId: emailCampaign2.id,
  });

  const { data: afterRecipients } = await admin
    .from("campaign_recipients")
    .select("customer_id, status")
    .eq("campaign_id", emailCampaign2.id)
    .eq("tenant_id", CAANTA);

  const skippedAfterUnsub = (afterRecipients ?? []).find(
    (r) => r.customer_id === optedInId,
  );
  assert(
    skippedAfterUnsub?.status === "skipped_opted_out",
    `expected skipped after unsubscribe, got ${skippedAfterUnsub?.status}`,
  );
  console.log("OK re-send after unsubscribe skips that customer");

  const bothCode = await allocateCode();
  const { data: bothTemplate, error: bothTmplErr } = await admin
    .from("message_templates")
    .insert({
      tenant_id: CAANTA,
      name: `Both Smoke ${stamp}`,
      template_type: "marketing",
      channel: "both",
      subject: "Both {{customer_name}}",
      body_email: "Email body {{customer_name}}",
      body_sms: "SMS body {{customer_name}}",
      variables: ["customer_name"],
      is_active: true,
    })
    .select(
      "id, name, channel, subject, body_email, body_sms, variables, is_active",
    )
    .single();
  assert(
    !bothTmplErr && bothTemplate,
    bothTmplErr?.message ?? "both template missing",
  );

  const { data: bothCampaign, error: bothCampErr } = await admin
    .from("campaigns")
    .insert({
      tenant_id: CAANTA,
      campaign_code: bothCode,
      name: `Both Batch Smoke ${stamp}`,
      template_id: bothTemplate.id,
      channel: "both",
      audience_filter: {
        type: "customer_type",
        value: "service_client",
      },
      status: "draft",
      total_recipients: 0,
    })
    .select(
      "id, tenant_id, name, template_id, channel, audience_filter, status, total_recipients",
    )
    .single();
  assert(
    !bothCampErr && bothCampaign,
    bothCampErr?.message ?? "both campaign missing",
  );

  await admin.from("campaign_recipients").delete().eq("campaign_id", bothCampaign.id);
  await admin
    .from("campaigns")
    .update({ status: "sending", sent_at: null, total_recipients: 0 })
    .eq("id", bothCampaign.id);

  const pendingInserts = [
    {
      tenant_id: CAANTA,
      campaign_id: bothCampaign.id,
      customer_id: optedInId,
      channel: "email",
      status: "pending",
    },
    {
      tenant_id: CAANTA,
      campaign_id: bothCampaign.id,
      customer_id: optedInId,
      channel: "sms",
      status: "pending",
    },
    {
      tenant_id: CAANTA,
      campaign_id: bothCampaign.id,
      customer_id: emailOnlyId,
      channel: "email",
      status: "pending",
    },
    {
      tenant_id: CAANTA,
      campaign_id: bothCampaign.id,
      customer_id: emailOnlyId,
      channel: "sms",
      status: "pending",
    },
  ];
  await admin.from("campaign_recipients").insert(pendingInserts);

  const beforeCount = pendingInserts.length;
  const { count: beforeRecipients } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", bothCampaign.id);
  assert(
    beforeRecipients === beforeCount,
    "recipient count mismatch before continue",
  );

  const batchA = await processCampaignSendBatch(admin as SupabaseClient, {
    tenantId: CAANTA,
    campaign: {
      id: bothCampaign.id,
      tenant_id: CAANTA,
      name: bothCampaign.name,
      template_id: bothTemplate.id,
      channel: "both",
      audience_filter: { type: "customer_type", value: "service_client" },
      status: "sending",
      total_recipients: 0,
    },
    template: {
      id: bothTemplate.id,
      name: bothTemplate.name,
      channel: "both",
      subject: bothTemplate.subject,
      body_email: bothTemplate.body_email,
      body_sms: bothTemplate.body_sms,
      variables: bothTemplate.variables,
      is_active: true,
    },
    batchSize: 1,
  });
  assert(batchA.pendingRemaining > 0, "expected remaining after batchSize=1");
  assert(batchA.status === "sending", "should stay sending");

  const { count: midCount } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", bothCampaign.id);
  assert(
    midCount === beforeCount,
    "continue must NOT re-resolve/duplicate recipients",
  );
  console.log("OK continue-send does not duplicate audience rows");

  await runCampaignSend(admin as SupabaseClient, {
    tenantId: CAANTA,
    campaignId: bothCampaign.id,
  });
  const { count: afterCount } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", bothCampaign.id);
  assert(
    afterCount === beforeCount,
    "second continue must not duplicate recipients",
  );
  console.log("OK re-calling send on sending status continues without re-resolve");

  if (resendConfigured) {
    const probe = await sendResendEmail({
      to: `optin.${stamp}@example.com`,
      subject: "staging probe",
      html: "<p>probe</p>",
      text: "probe",
    });
    console.log("Resend probe:", probe.ok ? "ok" : probe.error);
  } else {
    console.log(
      "Resend NOT configured in .env.staging.local — email path fails gracefully",
    );
  }
  if (hubtelConfigured) {
    const probe = await sendHubtelSms({
      to: "0244111002",
      content: "staging probe",
    });
    console.log("Hubtel probe:", probe.ok ? "ok" : probe.error);
  } else {
    console.log(
      "Hubtel credentials NOT configured on staging env file (still placeholder / missing)",
    );
  }

  const campaignIds = [
    smsCampaign.id,
    emailCampaign.id,
    emailCampaign2.id,
    bothCampaign.id,
  ];
  await admin.from("campaign_recipients").delete().in("campaign_id", campaignIds);
  await admin.from("campaigns").delete().in("id", campaignIds);
  await admin
    .from("message_templates")
    .delete()
    .in("id", [emailTemplate.id, smsTemplate.id, bothTemplate.id]);
  await admin
    .from("customer_comm_preferences")
    .delete()
    .eq("tenant_id", CAANTA)
    .in("customer_id", [optedOutId, optedInId, emailOnlyId]);
  await admin
    .from("customers")
    .delete()
    .eq("tenant_id", CAANTA)
    .in("client_id", [optedOutId, optedInId, emailOnlyId]);

  console.log("OK cleaned smoke data");
  console.log("DONE");
  console.log(
    JSON.stringify(
      {
        resendConfigured,
        hubtelConfigured,
        smsSkippedOptOut: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
