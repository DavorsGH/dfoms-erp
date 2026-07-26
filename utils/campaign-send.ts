import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAudienceFilter,
  type CampaignAudienceFilter,
  type CampaignChannel,
} from "@/utils/campaigns-types";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import {
  escapeHtml,
  substituteTemplatePlaceholders,
  templateBodyToEmailHtml,
} from "@/utils/message-template-render";
import { sendResendEmail } from "@/utils/resend-email";

export const CAMPAIGN_SEND_BATCH_SIZE = 50;

export const UNSUBSCRIBE_BASE_URL =
  "https://portal.davorsfacilities.com/unsubscribe";

export type RecipientDeliveryChannel = "email" | "sms";

export type CampaignRecipientStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped_opted_out";

export type CampaignCustomer = {
  client_id: string;
  client_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  customer_type: string | null;
  status: string | null;
  [key: string]: unknown;
};

export type CommPreferenceRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  unsubscribed_at: string | null;
  unsubscribe_token: string;
};

export type MessageTemplateForSend = {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
  variables: unknown;
  is_active: boolean;
};

export type CampaignForSend = {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string;
  channel: CampaignChannel;
  audience_filter: CampaignAudienceFilter;
  status: string;
  total_recipients: number;
};

export type AudiencePreview = {
  customerCount: number;
  pendingCount: number;
  skippedOptedOutCount: number;
  missingContactCount: number;
};

export type SendBatchResult = {
  campaignId: string;
  status: string;
  processed: number;
  sent: number;
  failed: number;
  skippedOptedOut: number;
  pendingRemaining: number;
  totalRecipients: number;
  message: string;
};

function deliveryChannelsForCampaign(
  channel: CampaignChannel,
): RecipientDeliveryChannel[] {
  if (channel === "both") return ["email", "sms"];
  if (channel === "sms") return ["sms"];
  return ["email"];
}

export function isChannelOptedIn(
  pref: CommPreferenceRow | null | undefined,
  channel: RecipientDeliveryChannel,
): boolean {
  if (!pref) return true;
  if (pref.unsubscribed_at) return false;
  if (channel === "email") return pref.email_opt_in !== false;
  return pref.sms_opt_in !== false;
}

export function hasContactForChannel(
  customer: CampaignCustomer,
  channel: RecipientDeliveryChannel,
): boolean {
  if (channel === "email") {
    return Boolean(customer.email?.trim());
  }
  return Boolean(customer.phone?.trim());
}

export function buildCustomerVariables(
  customer: CampaignCustomer,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(customer)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      vars[key] = String(value);
    }
  }
  vars.customer_name = customer.client_name?.trim() || customer.client_id;
  vars.customer_id = customer.client_id;
  if (customer.email?.trim()) vars.email = customer.email.trim();
  if (customer.phone?.trim()) vars.phone = customer.phone.trim();
  if (customer.contact_person?.trim()) {
    vars.contact_person = customer.contact_person.trim();
  }
  return vars;
}

export function buildUnsubscribeUrl(token: string): string {
  return `${UNSUBSCRIBE_BASE_URL}/${token}`;
}

export function appendEmailUnsubscribeFooter(
  body: string,
  token: string,
): { html: string; text: string } {
  const url = buildUnsubscribeUrl(token);
  const textBody = body.trimEnd();
  const text = `${textBody}\n\nUnsubscribe: ${url}`;
  const htmlBody = templateBodyToEmailHtml(body);
  const html = `${htmlBody}<p style="margin-top:24px;font-size:12px;color:#64748b;">Unsubscribe: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
  return { html, text };
}

export function appendSmsUnsubscribeFooter(body: string, token: string): string {
  const trimmed = body.trimEnd();
  return `${trimmed} Reply STOP or visit portal.davorsfacilities.com/unsubscribe/${token} to opt out`;
}

export async function loadCampaignCustomers(
  supabase: SupabaseClient,
  tenantId: string,
  audience: CampaignAudienceFilter,
): Promise<CampaignCustomer[]> {
  let query = supabase
    .from("customers")
    .select(
      "client_id, client_name, contact_person, phone, email, address, customer_type, status",
    )
    .eq("tenant_id", tenantId);

  if (audience.type === "customer_type") {
    query = query.eq("customer_type", audience.value);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data as CampaignCustomer[] | null) ?? [];
}

export async function loadCommPreferencesMap(
  supabase: SupabaseClient,
  tenantId: string,
  customerIds: string[],
): Promise<Map<string, CommPreferenceRow>> {
  const map = new Map<string, CommPreferenceRow>();
  if (customerIds.length === 0) return map;

  // Chunk to avoid URL length limits on large audiences.
  const chunkSize = 200;
  for (let i = 0; i < customerIds.length; i += chunkSize) {
    const chunk = customerIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("customer_comm_preferences")
      .select(
        "id, tenant_id, customer_id, email_opt_in, sms_opt_in, unsubscribed_at, unsubscribe_token",
      )
      .eq("tenant_id", tenantId)
      .in("customer_id", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data as CommPreferenceRow[] | null) ?? []) {
      map.set(row.customer_id, row);
    }
  }

  return map;
}

export function previewAudienceResolution(options: {
  customers: CampaignCustomer[];
  preferences: Map<string, CommPreferenceRow>;
  campaignChannel: CampaignChannel;
}): AudiencePreview {
  const channels = deliveryChannelsForCampaign(options.campaignChannel);
  let pendingCount = 0;
  let skippedOptedOutCount = 0;
  let missingContactCount = 0;

  for (const customer of options.customers) {
    const pref = options.preferences.get(customer.client_id);
    for (const channel of channels) {
      if (!hasContactForChannel(customer, channel)) {
        missingContactCount += 1;
        continue;
      }
      if (!isChannelOptedIn(pref, channel)) {
        skippedOptedOutCount += 1;
        continue;
      }
      pendingCount += 1;
    }
  }

  return {
    customerCount: options.customers.length,
    pendingCount,
    skippedOptedOutCount,
    missingContactCount,
  };
}

export async function resolveAudienceAndInsertRecipients(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    campaignId: string;
    campaignChannel: CampaignChannel;
    audience: CampaignAudienceFilter;
  },
): Promise<AudiencePreview> {
  const customers = await loadCampaignCustomers(
    supabase,
    options.tenantId,
    options.audience,
  );
  const preferences = await loadCommPreferencesMap(
    supabase,
    options.tenantId,
    customers.map((c) => c.client_id),
  );

  const channels = deliveryChannelsForCampaign(options.campaignChannel);
  const rows: Array<{
    tenant_id: string;
    campaign_id: string;
    customer_id: string;
    channel: RecipientDeliveryChannel;
    status: CampaignRecipientStatus;
  }> = [];

  let pendingCount = 0;
  let skippedOptedOutCount = 0;
  let missingContactCount = 0;

  for (const customer of customers) {
    const pref = preferences.get(customer.client_id);
    for (const channel of channels) {
      if (!hasContactForChannel(customer, channel)) {
        missingContactCount += 1;
        continue;
      }
      if (!isChannelOptedIn(pref, channel)) {
        skippedOptedOutCount += 1;
        rows.push({
          tenant_id: options.tenantId,
          campaign_id: options.campaignId,
          customer_id: customer.client_id,
          channel,
          status: "skipped_opted_out",
        });
        continue;
      }
      pendingCount += 1;
      rows.push({
        tenant_id: options.tenantId,
        campaign_id: options.campaignId,
        customer_id: customer.client_id,
        channel,
        status: "pending",
      });
    }
  }

  if (rows.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase.from("campaign_recipients").insert(chunk);
      if (error) {
        throw new Error(error.message);
      }
    }
  }

  return {
    customerCount: customers.length,
    pendingCount,
    skippedOptedOutCount,
    missingContactCount,
  };
}

async function ensureCommPreference(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<CommPreferenceRow> {
  const { data: existing, error: fetchError } = await supabase
    .from("customer_comm_preferences")
    .select(
      "id, tenant_id, customer_id, email_opt_in, sms_opt_in, unsubscribed_at, unsubscribe_token",
    )
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }
  if (existing) {
    return existing as CommPreferenceRow;
  }

  const { data: created, error: insertError } = await supabase
    .from("customer_comm_preferences")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      email_opt_in: true,
      sms_opt_in: true,
    })
    .select(
      "id, tenant_id, customer_id, email_opt_in, sms_opt_in, unsubscribed_at, unsubscribe_token",
    )
    .single();

  if (insertError) {
    // Race: another request created the row — re-fetch.
    const { data: raced, error: raceError } = await supabase
      .from("customer_comm_preferences")
      .select(
        "id, tenant_id, customer_id, email_opt_in, sms_opt_in, unsubscribed_at, unsubscribe_token",
      )
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (raceError) throw new Error(raceError.message);
    if (raced) return raced as CommPreferenceRow;
    throw new Error(insertError.message);
  }

  return created as CommPreferenceRow;
}

async function countRecipientsByStatus(
  supabase: SupabaseClient,
  tenantId: string,
  campaignId: string,
  status?: string | string[],
): Promise<number> {
  let query = supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("campaign_id", campaignId);

  if (typeof status === "string") {
    query = query.eq("status", status);
  } else if (Array.isArray(status)) {
    query = query.in("status", status);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function processCampaignSendBatch(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    campaign: CampaignForSend;
    template: MessageTemplateForSend;
    batchSize?: number;
  },
): Promise<SendBatchResult> {
  const batchSize = options.batchSize ?? CAMPAIGN_SEND_BATCH_SIZE;
  const campaign = options.campaign;
  const template = options.template;

  const { data: pendingRows, error: pendingError } = await supabase
    .from("campaign_recipients")
    .select("id, customer_id, channel, status")
    .eq("tenant_id", options.tenantId)
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  const recipients = pendingRows ?? [];
  let sent = 0;
  let failed = 0;

  const customerIds = [...new Set(recipients.map((r) => r.customer_id))];
  const customersById = new Map<string, CampaignCustomer>();
  if (customerIds.length > 0) {
    const { data: customers, error: customersError } = await supabase
      .from("customers")
      .select(
        "client_id, client_name, contact_person, phone, email, address, customer_type, status",
      )
      .eq("tenant_id", options.tenantId)
      .in("client_id", customerIds);
    if (customersError) throw new Error(customersError.message);
    for (const row of (customers as CampaignCustomer[] | null) ?? []) {
      customersById.set(row.client_id, row);
    }
  }

  for (const recipient of recipients) {
    try {
      const channel = recipient.channel as RecipientDeliveryChannel;
      const customer = customersById.get(recipient.customer_id);
      if (!customer) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            error: "Customer record not found.",
            sent_at: null,
          })
          .eq("id", recipient.id)
          .eq("tenant_id", options.tenantId);
        failed += 1;
        continue;
      }

      const pref = await ensureCommPreference(
        supabase,
        options.tenantId,
        customer.client_id,
      );

      // Re-check opt-out at send time (preference may have changed since resolve).
      if (!isChannelOptedIn(pref, channel)) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "skipped_opted_out",
            error: null,
            sent_at: null,
          })
          .eq("id", recipient.id)
          .eq("tenant_id", options.tenantId);
        continue;
      }

      const vars = buildCustomerVariables(customer);
      const now = new Date().toISOString();

      if (channel === "email") {
        const subject = substituteTemplatePlaceholders(
          template.subject ?? "",
          vars,
        );
        const rawBody = substituteTemplatePlaceholders(
          template.body_email ?? "",
          vars,
        );
        const { html, text } = appendEmailUnsubscribeFooter(
          rawBody,
          pref.unsubscribe_token,
        );
        const to = customer.email?.trim() ?? "";
        if (!to) {
          await supabase
            .from("campaign_recipients")
            .update({
              status: "failed",
              error: "No email on file.",
              sent_at: null,
            })
            .eq("id", recipient.id)
            .eq("tenant_id", options.tenantId);
          failed += 1;
          continue;
        }

        const result = await sendResendEmail({ to, subject, html, text });
        if (result.ok) {
          await supabase
            .from("campaign_recipients")
            .update({
              status: "sent",
              provider_ref: result.id,
              error: null,
              sent_at: now,
            })
            .eq("id", recipient.id)
            .eq("tenant_id", options.tenantId);
          sent += 1;
        } else {
          await supabase
            .from("campaign_recipients")
            .update({
              status: "failed",
              error: result.error.slice(0, 1000),
              sent_at: null,
            })
            .eq("id", recipient.id)
            .eq("tenant_id", options.tenantId);
          failed += 1;
        }
        continue;
      }

      // SMS
      const rawSms = substituteTemplatePlaceholders(
        template.body_sms ?? "",
        vars,
      );
      const content = appendSmsUnsubscribeFooter(
        rawSms,
        pref.unsubscribe_token,
      );
      const to = customer.phone?.trim() ?? "";
      if (!to) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            error: "No phone on file.",
            sent_at: null,
          })
          .eq("id", recipient.id)
          .eq("tenant_id", options.tenantId);
        failed += 1;
        continue;
      }

      const result = await sendHubtelSms({ to, content });
      if (result.ok) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "sent",
            provider_ref: result.id,
            error: null,
            sent_at: now,
          })
          .eq("id", recipient.id)
          .eq("tenant_id", options.tenantId);
        sent += 1;
      } else {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            error: result.error.slice(0, 1000),
            sent_at: null,
          })
          .eq("id", recipient.id)
          .eq("tenant_id", options.tenantId);
        failed += 1;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected send failure.";
      await supabase
        .from("campaign_recipients")
        .update({
          status: "failed",
          error: message.slice(0, 1000),
          sent_at: null,
        })
        .eq("id", recipient.id)
        .eq("tenant_id", options.tenantId);
      failed += 1;
    }
  }

  const pendingRemaining = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    campaign.id,
    "pending",
  );
  const skippedOptedOut = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    campaign.id,
    "skipped_opted_out",
  );
  const totalTracked = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    campaign.id,
    ["sent", "failed", "skipped_opted_out"],
  );

  let status = campaign.status;
  let totalRecipients = campaign.total_recipients;
  const now = new Date().toISOString();

  if (pendingRemaining === 0) {
    status = "sent";
    totalRecipients = totalTracked;
    const { error: finalizeError } = await supabase
      .from("campaigns")
      .update({
        status: "sent",
        sent_at: now,
        total_recipients: totalRecipients,
        updated_at: now,
      })
      .eq("id", campaign.id)
      .eq("tenant_id", options.tenantId);
    if (finalizeError) throw new Error(finalizeError.message);
  }

  const processedTotal =
    (await countRecipientsByStatus(supabase, options.tenantId, campaign.id, [
      "sent",
      "failed",
      "skipped_opted_out",
    ])) ;
  const grandTotal = processedTotal + pendingRemaining;

  let message: string;
  if (status === "sent") {
    message = `Sent — ${totalRecipients} recipients (${skippedOptedOut} skipped, opted out).`;
  } else {
    message = `Sending… ${processedTotal} of ${grandTotal} processed — click Continue Sending for the next batch (${pendingRemaining} pending).`;
  }

  return {
    campaignId: campaign.id,
    status,
    processed: recipients.length,
    sent,
    failed,
    skippedOptedOut,
    pendingRemaining,
    totalRecipients: status === "sent" ? totalRecipients : grandTotal,
    message,
  };
}

export async function runCampaignSend(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    campaignId: string;
  },
): Promise<SendBatchResult> {
  const { data: campaignRaw, error: campaignError } = await supabase
    .from("campaigns")
    .select(
      "id, tenant_id, name, template_id, channel, audience_filter, status, total_recipients",
    )
    .eq("id", options.campaignId)
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (campaignError) throw new Error(campaignError.message);
  if (!campaignRaw) {
    throw Object.assign(new Error("Campaign not found."), { status: 404 });
  }
  if (campaignRaw.tenant_id !== options.tenantId) {
    throw Object.assign(new Error("Campaign does not belong to this workspace."), {
      status: 403,
    });
  }

  const audience =
    normalizeAudienceFilter(campaignRaw.audience_filter) ?? ({ type: "all" } as const);

  const campaign: CampaignForSend = {
    id: campaignRaw.id,
    tenant_id: campaignRaw.tenant_id,
    name: campaignRaw.name,
    template_id: campaignRaw.template_id,
    channel: campaignRaw.channel as CampaignChannel,
    audience_filter: audience,
    status: String(campaignRaw.status),
    total_recipients: Number(campaignRaw.total_recipients) || 0,
  };

  if (campaign.status !== "draft" && campaign.status !== "sending") {
    throw Object.assign(
      new Error(
        "Only draft or in-progress (sending) campaigns can be sent. This campaign has already finished or failed.",
      ),
      { status: 400 },
    );
  }

  const { data: templateRaw, error: templateError } = await supabase
    .from("message_templates")
    .select(
      "id, name, channel, subject, body_email, body_sms, variables, is_active, tenant_id",
    )
    .eq("id", campaign.template_id)
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (templateError) throw new Error(templateError.message);
  if (!templateRaw) {
    throw Object.assign(new Error("Campaign template not found in this workspace."), {
      status: 404,
    });
  }

  const template: MessageTemplateForSend = {
    id: templateRaw.id,
    name: templateRaw.name,
    channel: String(templateRaw.channel),
    subject: templateRaw.subject ?? null,
    body_email: templateRaw.body_email ?? null,
    body_sms: templateRaw.body_sms ?? null,
    variables: templateRaw.variables,
    is_active: templateRaw.is_active === true,
  };

  if (campaign.status === "draft") {
    const { count: existingCount, error: existingError } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", options.tenantId)
      .eq("campaign_id", campaign.id);

    if (existingError) throw new Error(existingError.message);

    if ((existingCount ?? 0) === 0) {
      await resolveAudienceAndInsertRecipients(supabase, {
        tenantId: options.tenantId,
        campaignId: campaign.id,
        campaignChannel: campaign.channel,
        audience,
      });
    }

    const now = new Date().toISOString();
    const { error: statusError } = await supabase
      .from("campaigns")
      .update({ status: "sending", updated_at: now })
      .eq("id", campaign.id)
      .eq("tenant_id", options.tenantId);
    if (statusError) throw new Error(statusError.message);
    campaign.status = "sending";
  }

  return processCampaignSendBatch(supabase, {
    tenantId: options.tenantId,
    campaign,
    template,
  });
}

export async function previewCampaignAudience(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    campaignId: string;
  },
): Promise<AudiencePreview & { campaignName: string; channel: CampaignChannel }> {
  const { data: campaignRaw, error } = await supabase
    .from("campaigns")
    .select("id, tenant_id, name, channel, audience_filter, status")
    .eq("id", options.campaignId)
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!campaignRaw) {
    throw Object.assign(new Error("Campaign not found."), { status: 404 });
  }

  const audience =
    normalizeAudienceFilter(campaignRaw.audience_filter) ?? ({ type: "all" } as const);
  const channel = campaignRaw.channel as CampaignChannel;
  const customers = await loadCampaignCustomers(
    supabase,
    options.tenantId,
    audience,
  );
  const preferences = await loadCommPreferencesMap(
    supabase,
    options.tenantId,
    customers.map((c) => c.client_id),
  );
  const preview = previewAudienceResolution({
    customers,
    preferences,
    campaignChannel: channel,
  });

  return {
    ...preview,
    campaignName: campaignRaw.name,
    channel,
  };
}
