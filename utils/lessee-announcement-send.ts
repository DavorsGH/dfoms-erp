import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAnnouncementLessees,
  type AnnouncementLessee,
} from "@/utils/lessee-announcements-audience";
import {
  normalizeAudienceFilter,
  normalizeChannels,
  type LesseeAnnouncementAudienceFilter,
  type LesseeAnnouncementChannel,
} from "@/utils/lessee-announcements-types";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import {
  substituteTemplatePlaceholders,
  templateBodyToEmailHtml,
} from "@/utils/message-template-render";
import { sendResendEmail } from "@/utils/resend-email";
import { tryDebitSmsCredit } from "@/utils/sms-credit";

export const LESSEE_ANNOUNCEMENT_SEND_BATCH_SIZE = 50;

export type LesseeAnnouncementRecipientStatus =
  | "sent"
  | "failed"
  | "skipped_no_contact"
  | "skipped_no_login"
  | "skipped_no_credit";

export type LesseeAnnouncementMessageContent = {
  subject: string | null;
  body: string;
  source: "template" | "adhoc";
  templateName: string | null;
};

export type LesseeAnnouncementForSend = {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string | null;
  channels: LesseeAnnouncementChannel[];
  subject: string | null;
  body: string | null;
  audience_filter: LesseeAnnouncementAudienceFilter;
  status: string;
  total_recipients: number;
};

export type LesseeAudiencePreview = {
  lesseeCount: number;
  pendingCount: number;
  skippedNoContactCount: number;
  skippedNoLoginCount: number;
};

export type LesseeSendBatchResult = {
  announcementId: string;
  status: string;
  processed: number;
  sent: number;
  failed: number;
  skippedNoContact: number;
  skippedNoLogin: number;
  skippedNoCredit: number;
  pendingRemaining: number;
  totalRecipients: number;
  message: string;
};

type EligibleDelivery = {
  lessee_id: string;
  channel: LesseeAnnouncementChannel;
};

export function hasContactForChannel(
  lessee: AnnouncementLessee,
  channel: LesseeAnnouncementChannel,
): boolean {
  if (channel === "email") {
    return Boolean(lessee.email?.trim());
  }
  if (channel === "sms") {
    return Boolean(lessee.phone?.trim());
  }
  return true;
}

export function buildLesseeVariables(
  lessee: AnnouncementLessee,
): Record<string, string> {
  const vars: Record<string, string> = {};
  vars.lessee_id = lessee.lessee_id;
  vars.full_name = lessee.full_name?.trim() || lessee.lessee_id;
  vars.tenant_name = lessee.full_name?.trim() || lessee.lessee_id;
  vars.lessee_name = lessee.full_name?.trim() || lessee.lessee_id;
  if (lessee.email?.trim()) vars.email = lessee.email.trim();
  if (lessee.phone?.trim()) vars.phone = lessee.phone.trim();
  if (lessee.property_name?.trim()) {
    vars.property_name = lessee.property_name.trim();
    vars.property = lessee.property_name.trim();
  }
  if (lessee.unit_number?.trim()) {
    vars.unit_number = lessee.unit_number.trim();
    vars.unit = lessee.unit_number.trim();
  }
  if (lessee.lease_id?.trim()) vars.lease_id = lessee.lease_id.trim();
  return vars;
}

function classifyDeliveries(options: {
  lessees: AnnouncementLessee[];
  channels: LesseeAnnouncementChannel[];
}): {
  eligible: EligibleDelivery[];
  skips: Array<{
    lessee_id: string;
    channel: LesseeAnnouncementChannel;
    status: "skipped_no_contact" | "skipped_no_login";
    error_detail: string;
  }>;
  preview: LesseeAudiencePreview;
} {
  const eligible: EligibleDelivery[] = [];
  const skips: Array<{
    lessee_id: string;
    channel: LesseeAnnouncementChannel;
    status: "skipped_no_contact" | "skipped_no_login";
    error_detail: string;
  }> = [];

  for (const lessee of options.lessees) {
    for (const channel of options.channels) {
      if (channel === "in_app") {
        if (!lessee.auth_user_id?.trim()) {
          skips.push({
            lessee_id: lessee.lessee_id,
            channel,
            status: "skipped_no_login",
            error_detail: "No portal account linked to this tenant.",
          });
        } else {
          eligible.push({ lessee_id: lessee.lessee_id, channel });
        }
        continue;
      }

      if (!hasContactForChannel(lessee, channel)) {
        skips.push({
          lessee_id: lessee.lessee_id,
          channel,
          status: "skipped_no_contact",
          error_detail:
            channel === "email" ? "No email on file." : "No phone on file.",
        });
        continue;
      }

      eligible.push({ lessee_id: lessee.lessee_id, channel });
    }
  }

  return {
    eligible,
    skips,
    preview: {
      lesseeCount: options.lessees.length,
      pendingCount: eligible.length,
      skippedNoContactCount: skips.filter((s) => s.status === "skipped_no_contact")
        .length,
      skippedNoLoginCount: skips.filter((s) => s.status === "skipped_no_login")
        .length,
    },
  };
}

export function previewAudienceResolution(options: {
  lessees: AnnouncementLessee[];
  channels: LesseeAnnouncementChannel[];
}): LesseeAudiencePreview {
  return classifyDeliveries(options).preview;
}

async function loadExistingRecipientKeys(
  supabase: SupabaseClient,
  tenantId: string,
  announcementId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const { data, error } = await supabase
    .from("lessee_announcement_recipients")
    .select("lessee_id, channel")
    .eq("tenant_id", tenantId)
    .eq("announcement_id", announcementId);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    keys.add(`${row.lessee_id}::${row.channel}`);
  }
  return keys;
}

function deliveryKey(lesseeId: string, channel: string): string {
  return `${lesseeId}::${channel}`;
}

export async function resolveAudienceAndInsertSkipRows(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
    channels: LesseeAnnouncementChannel[];
    audience: LesseeAnnouncementAudienceFilter;
  },
): Promise<LesseeAudiencePreview> {
  const lessees = await loadAnnouncementLessees(
    supabase,
    options.tenantId,
    options.audience,
  );
  const { skips, preview } = classifyDeliveries({
    lessees,
    channels: options.channels,
  });

  if (skips.length > 0) {
    const rows = skips.map((skip) => ({
      tenant_id: options.tenantId,
      announcement_id: options.announcementId,
      lessee_id: skip.lessee_id,
      channel: skip.channel,
      status: skip.status,
      error_detail: skip.error_detail,
    }));

    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("lessee_announcement_recipients")
        .insert(chunk);
      if (error) {
        throw new Error(error.message);
      }
    }
  }

  return preview;
}

async function countRecipientsByStatus(
  supabase: SupabaseClient,
  tenantId: string,
  announcementId: string,
  status?: string | string[],
): Promise<number> {
  let query = supabase
    .from("lessee_announcement_recipients")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("announcement_id", announcementId);

  if (typeof status === "string") {
    query = query.eq("status", status);
  } else if (Array.isArray(status)) {
    query = query.in("status", status);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadLesseeAnnouncementMessageContent(
  supabase: SupabaseClient,
  tenantId: string,
  announcement: LesseeAnnouncementForSend,
): Promise<LesseeAnnouncementMessageContent> {
  if (announcement.template_id) {
    const { data, error } = await supabase
      .from("lessee_message_templates")
      .select("id, name, subject, body, is_active, tenant_id")
      .eq("id", announcement.template_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw Object.assign(
        new Error("Announcement template not found for this landlord."),
        { status: 404 },
      );
    }
    if (data.is_active !== true) {
      throw Object.assign(
        new Error("Announcement template is inactive and cannot be sent."),
        { status: 400 },
      );
    }

    const body = String(data.body ?? "").trim();
    if (!body) {
      throw Object.assign(new Error("Template body is empty."), { status: 400 });
    }

    return {
      subject: data.subject?.trim() || announcement.name,
      body,
      source: "template",
      templateName: data.name ?? null,
    };
  }

  const body = (announcement.body ?? "").trim();
  if (!body) {
    throw Object.assign(
      new Error("Announcement has no template and no message body."),
      { status: 400 },
    );
  }

  return {
    subject: (announcement.subject ?? "").trim() || announcement.name,
    body,
    source: "adhoc",
    templateName: null,
  };
}

async function listRemainingEligible(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcement: LesseeAnnouncementForSend;
  },
): Promise<{
  lessees: AnnouncementLessee[];
  remaining: EligibleDelivery[];
}> {
  const lessees = await loadAnnouncementLessees(
    supabase,
    options.tenantId,
    options.announcement.audience_filter,
  );
  const existing = await loadExistingRecipientKeys(
    supabase,
    options.tenantId,
    options.announcement.id,
  );
  const { eligible } = classifyDeliveries({
    lessees,
    channels: options.announcement.channels,
  });

  const remaining = eligible.filter(
    (item) => !existing.has(deliveryKey(item.lessee_id, item.channel)),
  );

  return { lessees, remaining };
}

export async function processLesseeAnnouncementSendBatch(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcement: LesseeAnnouncementForSend;
    content: LesseeAnnouncementMessageContent;
    batchSize?: number;
  },
): Promise<LesseeSendBatchResult> {
  const batchSize = options.batchSize ?? LESSEE_ANNOUNCEMENT_SEND_BATCH_SIZE;
  const announcement = options.announcement;
  const content = options.content;

  const { lessees, remaining } = await listRemainingEligible(supabase, {
    tenantId: options.tenantId,
    announcement,
  });

  const batch = remaining.slice(0, batchSize);
  const lesseesById = new Map(
    lessees.map((lessee) => [lessee.lessee_id, lessee]),
  );

  let sent = 0;
  let failed = 0;

  for (const item of batch) {
    const lessee = lesseesById.get(item.lessee_id);
    if (!lessee) {
      const { error } = await supabase
        .from("lessee_announcement_recipients")
        .insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          lessee_id: item.lessee_id,
          channel: item.channel,
          status: "failed",
          error_detail: "Tenant record not found.",
        });
      if (error) throw new Error(error.message);
      failed += 1;
      continue;
    }

    try {
      const vars = buildLesseeVariables(lessee);
      const resolvedBody = substituteTemplatePlaceholders(content.body, vars);
      const resolvedSubject = substituteTemplatePlaceholders(
        content.subject ?? announcement.name,
        vars,
      );
      const now = new Date().toISOString();

      if (item.channel === "email") {
        const to = lessee.email?.trim() ?? "";
        if (!to) {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "email",
            status: "skipped_no_contact",
            error_detail: "No email on file.",
          });
          continue;
        }

        const html = templateBodyToEmailHtml(resolvedBody);
        const result = await sendResendEmail({
          to,
          subject: resolvedSubject,
          html,
          text: resolvedBody,
        });
        if (result.ok) {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "email",
            status: "sent",
            error_detail: null,
            sent_at: now,
          });
          sent += 1;
        } else {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "email",
            status: "failed",
            error_detail: result.error.slice(0, 1000),
          });
          failed += 1;
        }
        continue;
      }

      if (item.channel === "sms") {
        const to = lessee.phone?.trim() ?? "";
        if (!to) {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "sms",
            status: "skipped_no_contact",
            error_detail: "No phone on file.",
          });
          continue;
        }

        const creditOk = await tryDebitSmsCredit(options.tenantId);
        if (!creditOk) {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "sms",
            status: "skipped_no_credit",
            error_detail: "No SMS credits.",
          });
          continue;
        }

        const result = await sendHubtelSms({ to, content: resolvedBody });
        if (result.ok) {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "sms",
            status: "sent",
            error_detail: null,
            sent_at: now,
          });
          sent += 1;
        } else {
          await supabase.from("lessee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            lessee_id: lessee.lessee_id,
            channel: "sms",
            status: "failed",
            error_detail: result.error.slice(0, 1000),
          });
          failed += 1;
        }
        continue;
      }

      // in_app
      const authUserId = lessee.auth_user_id?.trim() ?? "";
      if (!authUserId) {
        await supabase.from("lessee_announcement_recipients").insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          lessee_id: lessee.lessee_id,
          channel: "in_app",
          status: "skipped_no_login",
          error_detail: "No portal account linked to this tenant.",
        });
        continue;
      }

      const { error: notifError } = await supabase
        .from("lessee_notifications")
        .insert({
          tenant_id: options.tenantId,
          recipient_user_id: authUserId,
          lessee_id: lessee.lessee_id,
          announcement_id: announcement.id,
          title: resolvedSubject || announcement.name,
          body: resolvedBody,
        });

      if (notifError) {
        await supabase.from("lessee_announcement_recipients").insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          lessee_id: lessee.lessee_id,
          channel: "in_app",
          status: "failed",
          error_detail: notifError.message.slice(0, 1000),
        });
        failed += 1;
        continue;
      }

      await supabase.from("lessee_announcement_recipients").insert({
        tenant_id: options.tenantId,
        announcement_id: announcement.id,
        lessee_id: lessee.lessee_id,
        channel: "in_app",
        status: "sent",
        error_detail: null,
        sent_at: now,
      });
      sent += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected send failure.";
      await supabase.from("lessee_announcement_recipients").insert({
        tenant_id: options.tenantId,
        announcement_id: announcement.id,
        lessee_id: item.lessee_id,
        channel: item.channel,
        status: "failed",
        error_detail: message.slice(0, 1000),
      });
      failed += 1;
    }
  }

  const pendingRemaining = Math.max(0, remaining.length - batch.length);
  const skippedNoContact = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    announcement.id,
    "skipped_no_contact",
  );
  const skippedNoLogin = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    announcement.id,
    "skipped_no_login",
  );
  const skippedNoCredit = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    announcement.id,
    "skipped_no_credit",
  );
  const processedTotal = await countRecipientsByStatus(
    supabase,
    options.tenantId,
    announcement.id,
  );

  let status = announcement.status;
  let totalRecipients = announcement.total_recipients;
  const now = new Date().toISOString();

  if (pendingRemaining === 0) {
    status = "sent";
    totalRecipients = processedTotal;
    const { error: finalizeError } = await supabase
      .from("lessee_announcements")
      .update({
        status: "sent",
        sent_at: now,
        total_recipients: totalRecipients,
      })
      .eq("id", announcement.id)
      .eq("tenant_id", options.tenantId);
    if (finalizeError) throw new Error(finalizeError.message);
  }

  const grandTotal = processedTotal + pendingRemaining;
  let message: string;
  if (status === "sent") {
    message =
      `Sent — ${totalRecipients} delivery rows ` +
      `(${skippedNoContact} no contact, ${skippedNoLogin} no portal login, ` +
      `${skippedNoCredit} no SMS credit).`;
  } else {
    message =
      `Sending… ${processedTotal} of ${grandTotal} processed — ` +
      `click Continue Sending for the next batch (${pendingRemaining} pending).`;
  }

  return {
    announcementId: announcement.id,
    status,
    processed: batch.length,
    sent,
    failed,
    skippedNoContact,
    skippedNoLogin,
    skippedNoCredit,
    pendingRemaining,
    totalRecipients: status === "sent" ? totalRecipients : grandTotal,
    message,
  };
}

export async function runLesseeAnnouncementSend(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
  },
): Promise<LesseeSendBatchResult> {
  const { data: raw, error } = await supabase
    .from("lessee_announcements")
    .select(
      "id, tenant_id, name, template_id, channels, subject, body, audience_filter, status, total_recipients",
    )
    .eq("id", options.announcementId)
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!raw) {
    throw Object.assign(new Error("Announcement not found."), { status: 404 });
  }
  if (raw.tenant_id !== options.tenantId) {
    throw Object.assign(
      new Error("Announcement does not belong to this landlord."),
      { status: 403 },
    );
  }

  const audience =
    normalizeAudienceFilter(raw.audience_filter) ?? ({ type: "all" } as const);
  const channels = normalizeChannels(raw.channels);
  if (channels.length === 0) {
    throw Object.assign(
      new Error("Announcement has no channels selected."),
      { status: 400 },
    );
  }

  const announcement: LesseeAnnouncementForSend = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    name: raw.name,
    template_id: raw.template_id ?? null,
    channels,
    subject: raw.subject ?? null,
    body: raw.body ?? null,
    audience_filter: audience,
    status: String(raw.status),
    total_recipients: Number(raw.total_recipients) || 0,
  };

  if (announcement.status !== "draft" && announcement.status !== "sending") {
    throw Object.assign(
      new Error(
        "Only draft or in-progress (sending) announcements can be sent. This announcement has already finished or failed.",
      ),
      { status: 400 },
    );
  }

  const content = await loadLesseeAnnouncementMessageContent(
    supabase,
    options.tenantId,
    announcement,
  );

  if (announcement.status === "draft") {
    const { count: existingCount, error: existingError } = await supabase
      .from("lessee_announcement_recipients")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", options.tenantId)
      .eq("announcement_id", announcement.id);

    if (existingError) throw new Error(existingError.message);

    if ((existingCount ?? 0) === 0) {
      await resolveAudienceAndInsertSkipRows(supabase, {
        tenantId: options.tenantId,
        announcementId: announcement.id,
        channels,
        audience,
      });
    }

    const { error: statusError } = await supabase
      .from("lessee_announcements")
      .update({ status: "sending" })
      .eq("id", announcement.id)
      .eq("tenant_id", options.tenantId);
    if (statusError) throw new Error(statusError.message);
    announcement.status = "sending";
  }

  return processLesseeAnnouncementSendBatch(supabase, {
    tenantId: options.tenantId,
    announcement,
    content,
  });
}

export async function previewLesseeAnnouncementAudience(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
  },
): Promise<
  LesseeAudiencePreview & {
    announcementName: string;
    channels: LesseeAnnouncementChannel[];
  }
> {
  const { data: raw, error } = await supabase
    .from("lessee_announcements")
    .select("id, tenant_id, name, channels, audience_filter, status")
    .eq("id", options.announcementId)
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!raw) {
    throw Object.assign(new Error("Announcement not found."), { status: 404 });
  }

  const audience =
    normalizeAudienceFilter(raw.audience_filter) ?? ({ type: "all" } as const);
  const channels = normalizeChannels(raw.channels);
  const lessees = await loadAnnouncementLessees(
    supabase,
    options.tenantId,
    audience,
  );
  const preview = previewAudienceResolution({
    lessees,
    channels,
  });

  return {
    ...preview,
    announcementName: raw.name,
    channels,
  };
}
