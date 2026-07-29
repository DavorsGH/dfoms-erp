import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAnnouncementEmployees,
  type AnnouncementEmployee,
} from "@/utils/employee-announcements-audience";
import {
  normalizeAudienceFilter,
  normalizeChannels,
  type EmployeeAnnouncementAudienceFilter,
  type EmployeeAnnouncementChannel,
} from "@/utils/employee-announcements-types";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import {
  substituteTemplatePlaceholders,
  templateBodyToEmailHtml,
} from "@/utils/message-template-render";
import { sendResendEmail } from "@/utils/resend-email";
import { tryDebitSmsCredit } from "@/utils/sms-credit";

export const ANNOUNCEMENT_SEND_BATCH_SIZE = 50;

export type AnnouncementRecipientStatus =
  | "sent"
  | "failed"
  | "skipped_no_contact"
  | "skipped_no_login"
  | "skipped_no_credit";

export type AnnouncementMessageContent = {
  subject: string | null;
  body: string;
  source: "template" | "adhoc";
  templateName: string | null;
};

export type AnnouncementForSend = {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string | null;
  channels: EmployeeAnnouncementChannel[];
  subject: string | null;
  body: string | null;
  audience_filter: EmployeeAnnouncementAudienceFilter;
  status: string;
  total_recipients: number;
};

export type AudiencePreview = {
  employeeCount: number;
  pendingCount: number;
  skippedNoContactCount: number;
  skippedNoLoginCount: number;
};

export type SendBatchResult = {
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

type UserAccountLink = {
  auth_uid: string;
  employee_id: string;
  email: string | null;
  is_active: boolean | null;
};

type EligibleDelivery = {
  employee_id: string;
  channel: EmployeeAnnouncementChannel;
};

export function hasContactForChannel(
  employee: AnnouncementEmployee,
  channel: EmployeeAnnouncementChannel,
): boolean {
  if (channel === "email") {
    return Boolean(employee.email?.trim());
  }
  if (channel === "sms") {
    return Boolean(employee.phone?.trim());
  }
  return true;
}

export function buildEmployeeVariables(
  employee: AnnouncementEmployee,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(employee)) {
    if (value == null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      vars[key] = String(value);
    }
  }
  vars.employee_name = employee.full_name?.trim() || employee.staff_id;
  vars.staff_id = employee.staff_id;
  vars.employee_id = employee.employee_id;
  if (employee.email?.trim()) vars.email = employee.email.trim();
  if (employee.phone?.trim()) vars.phone = employee.phone.trim();
  if (employee.position?.trim()) vars.position = employee.position.trim();
  if (employee.shift?.trim()) vars.shift = employee.shift.trim();
  if (employee.employment_type?.trim()) {
    vars.employment_type = employee.employment_type.trim();
  }
  return vars;
}

export async function loadEmployeeLoginMap(
  supabase: SupabaseClient,
  tenantId: string,
  employeeIds: string[],
): Promise<Map<string, UserAccountLink>> {
  const map = new Map<string, UserAccountLink>();
  if (employeeIds.length === 0) return map;

  const chunkSize = 200;
  for (let i = 0; i < employeeIds.length; i += chunkSize) {
    const chunk = employeeIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("user_accounts")
      .select("auth_uid, employee_id, email, is_active")
      .eq("tenant_id", tenantId)
      .in("employee_id", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data as UserAccountLink[] | null) ?? []) {
      if (!row.employee_id || !row.auth_uid) continue;
      const existing = map.get(row.employee_id);
      if (existing && existing.is_active !== false && row.is_active === false) {
        continue;
      }
      map.set(row.employee_id, row);
    }
  }

  return map;
}

function classifyDeliveries(options: {
  employees: AnnouncementEmployee[];
  logins: Map<string, UserAccountLink>;
  channels: EmployeeAnnouncementChannel[];
}): {
  eligible: EligibleDelivery[];
  skips: Array<{
    employee_id: string;
    channel: EmployeeAnnouncementChannel;
    status: "skipped_no_contact" | "skipped_no_login";
    error_detail: string;
  }>;
  preview: AudiencePreview;
} {
  const eligible: EligibleDelivery[] = [];
  const skips: Array<{
    employee_id: string;
    channel: EmployeeAnnouncementChannel;
    status: "skipped_no_contact" | "skipped_no_login";
    error_detail: string;
  }> = [];

  for (const employee of options.employees) {
    const login = options.logins.get(employee.employee_id);
    for (const channel of options.channels) {
      if (channel === "in_app") {
        if (!login || login.is_active === false) {
          skips.push({
            employee_id: employee.employee_id,
            channel,
            status: "skipped_no_login",
            error_detail: "No active user account linked to this employee.",
          });
        } else {
          eligible.push({ employee_id: employee.employee_id, channel });
        }
        continue;
      }

      if (!hasContactForChannel(employee, channel)) {
        skips.push({
          employee_id: employee.employee_id,
          channel,
          status: "skipped_no_contact",
          error_detail:
            channel === "email" ? "No email on file." : "No phone on file.",
        });
        continue;
      }

      eligible.push({ employee_id: employee.employee_id, channel });
    }
  }

  return {
    eligible,
    skips,
    preview: {
      employeeCount: options.employees.length,
      pendingCount: eligible.length,
      skippedNoContactCount: skips.filter((s) => s.status === "skipped_no_contact")
        .length,
      skippedNoLoginCount: skips.filter((s) => s.status === "skipped_no_login")
        .length,
    },
  };
}

export function previewAudienceResolution(options: {
  employees: AnnouncementEmployee[];
  logins: Map<string, UserAccountLink>;
  channels: EmployeeAnnouncementChannel[];
}): AudiencePreview {
  return classifyDeliveries(options).preview;
}

async function loadExistingRecipientKeys(
  supabase: SupabaseClient,
  tenantId: string,
  announcementId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const { data, error } = await supabase
    .from("employee_announcement_recipients")
    .select("employee_id, channel")
    .eq("tenant_id", tenantId)
    .eq("announcement_id", announcementId);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    keys.add(`${row.employee_id}::${row.channel}`);
  }
  return keys;
}

function deliveryKey(employeeId: string, channel: string): string {
  return `${employeeId}::${channel}`;
}

/**
 * First-send resolve: write skip rows only. Eligible deliveries stay queueless
 * (no recipient row yet) and are drained by processAnnouncementSendBatch.
 * Avoids needing a `pending` status (script 127 CHECK has terminal statuses only).
 */
export async function resolveAudienceAndInsertSkipRows(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
    channels: EmployeeAnnouncementChannel[];
    audience: EmployeeAnnouncementAudienceFilter;
  },
): Promise<AudiencePreview> {
  const employees = await loadAnnouncementEmployees(
    supabase,
    options.tenantId,
    options.audience,
  );
  const logins = await loadEmployeeLoginMap(
    supabase,
    options.tenantId,
    employees.map((e) => e.employee_id),
  );
  const { skips, preview } = classifyDeliveries({
    employees,
    logins,
    channels: options.channels,
  });

  if (skips.length > 0) {
    const rows = skips.map((skip) => ({
      tenant_id: options.tenantId,
      announcement_id: options.announcementId,
      employee_id: skip.employee_id,
      channel: skip.channel,
      status: skip.status,
      error_detail: skip.error_detail,
    }));

    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("employee_announcement_recipients")
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
    .from("employee_announcement_recipients")
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

export async function loadAnnouncementMessageContent(
  supabase: SupabaseClient,
  tenantId: string,
  announcement: AnnouncementForSend,
): Promise<AnnouncementMessageContent> {
  if (announcement.template_id) {
    const { data, error } = await supabase
      .from("employee_message_templates")
      .select("id, name, subject, body, is_active, tenant_id")
      .eq("id", announcement.template_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw Object.assign(
        new Error("Announcement template not found in this workspace."),
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
    announcement: AnnouncementForSend;
  },
): Promise<{
  employees: AnnouncementEmployee[];
  logins: Map<string, UserAccountLink>;
  remaining: EligibleDelivery[];
}> {
  const employees = await loadAnnouncementEmployees(
    supabase,
    options.tenantId,
    options.announcement.audience_filter,
  );
  const logins = await loadEmployeeLoginMap(
    supabase,
    options.tenantId,
    employees.map((e) => e.employee_id),
  );
  const existing = await loadExistingRecipientKeys(
    supabase,
    options.tenantId,
    options.announcement.id,
  );
  const { eligible } = classifyDeliveries({
    employees,
    logins,
    channels: options.announcement.channels,
  });

  const remaining = eligible.filter(
    (item) => !existing.has(deliveryKey(item.employee_id, item.channel)),
  );

  return { employees, logins, remaining };
}

export async function processAnnouncementSendBatch(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcement: AnnouncementForSend;
    content: AnnouncementMessageContent;
    batchSize?: number;
  },
): Promise<SendBatchResult> {
  const batchSize = options.batchSize ?? ANNOUNCEMENT_SEND_BATCH_SIZE;
  const announcement = options.announcement;
  const content = options.content;

  const { employees, logins, remaining } = await listRemainingEligible(
    supabase,
    {
      tenantId: options.tenantId,
      announcement,
    },
  );

  const batch = remaining.slice(0, batchSize);
  const employeesById = new Map(
    employees.map((employee) => [employee.employee_id, employee]),
  );

  let sent = 0;
  let failed = 0;

  for (const item of batch) {
    const employee = employeesById.get(item.employee_id);
    if (!employee) {
      const { error } = await supabase
        .from("employee_announcement_recipients")
        .insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          employee_id: item.employee_id,
          channel: item.channel,
          status: "failed",
          error_detail: "Employee record not found.",
        });
      if (error) throw new Error(error.message);
      failed += 1;
      continue;
    }

    try {
      const vars = buildEmployeeVariables(employee);
      const resolvedBody = substituteTemplatePlaceholders(content.body, vars);
      const resolvedSubject = substituteTemplatePlaceholders(
        content.subject ?? announcement.name,
        vars,
      );
      const now = new Date().toISOString();

      if (item.channel === "email") {
        const to = employee.email?.trim() ?? "";
        if (!to) {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
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
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "email",
            status: "sent",
            error_detail: null,
            sent_at: now,
          });
          sent += 1;
        } else {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "email",
            status: "failed",
            error_detail: result.error.slice(0, 1000),
          });
          failed += 1;
        }
        continue;
      }

      if (item.channel === "sms") {
        const to = employee.phone?.trim() ?? "";
        if (!to) {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "sms",
            status: "skipped_no_contact",
            error_detail: "No phone on file.",
          });
          continue;
        }

        const creditOk = await tryDebitSmsCredit(options.tenantId);
        if (!creditOk) {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "sms",
            status: "skipped_no_credit",
            error_detail: "No SMS credits.",
          });
          continue;
        }

        const result = await sendHubtelSms({ to, content: resolvedBody });
        if (result.ok) {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "sms",
            status: "sent",
            error_detail: null,
            sent_at: now,
          });
          sent += 1;
        } else {
          await supabase.from("employee_announcement_recipients").insert({
            tenant_id: options.tenantId,
            announcement_id: announcement.id,
            employee_id: employee.employee_id,
            channel: "sms",
            status: "failed",
            error_detail: result.error.slice(0, 1000),
          });
          failed += 1;
        }
        continue;
      }

      // in_app
      const login = logins.get(employee.employee_id);
      if (!login || login.is_active === false) {
        await supabase.from("employee_announcement_recipients").insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          employee_id: employee.employee_id,
          channel: "in_app",
          status: "skipped_no_login",
          error_detail: "No active user account linked to this employee.",
        });
        continue;
      }

      const { error: notifError } = await supabase
        .from("employee_notifications")
        .insert({
          tenant_id: options.tenantId,
          recipient_user_id: login.auth_uid,
          announcement_id: announcement.id,
          title: resolvedSubject || announcement.name,
          body: resolvedBody,
        });

      if (notifError) {
        await supabase.from("employee_announcement_recipients").insert({
          tenant_id: options.tenantId,
          announcement_id: announcement.id,
          employee_id: employee.employee_id,
          channel: "in_app",
          status: "failed",
          error_detail: notifError.message.slice(0, 1000),
        });
        failed += 1;
        continue;
      }

      await supabase.from("employee_announcement_recipients").insert({
        tenant_id: options.tenantId,
        announcement_id: announcement.id,
        employee_id: employee.employee_id,
        channel: "in_app",
        status: "sent",
        error_detail: null,
        sent_at: now,
      });
      sent += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected send failure.";
      await supabase.from("employee_announcement_recipients").insert({
        tenant_id: options.tenantId,
        announcement_id: announcement.id,
        employee_id: item.employee_id,
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
      .from("employee_announcements")
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
      `(${skippedNoContact} no contact, ${skippedNoLogin} no login, ` +
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

export async function runAnnouncementSend(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
  },
): Promise<SendBatchResult> {
  const { data: raw, error } = await supabase
    .from("employee_announcements")
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
      new Error("Announcement does not belong to this workspace."),
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

  const announcement: AnnouncementForSend = {
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

  const content = await loadAnnouncementMessageContent(
    supabase,
    options.tenantId,
    announcement,
  );

  if (announcement.status === "draft") {
    const { count: existingCount, error: existingError } = await supabase
      .from("employee_announcement_recipients")
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
      .from("employee_announcements")
      .update({ status: "sending" })
      .eq("id", announcement.id)
      .eq("tenant_id", options.tenantId);
    if (statusError) throw new Error(statusError.message);
    announcement.status = "sending";
  }

  return processAnnouncementSendBatch(supabase, {
    tenantId: options.tenantId,
    announcement,
    content,
  });
}

export async function previewAnnouncementAudience(
  supabase: SupabaseClient,
  options: {
    tenantId: string;
    announcementId: string;
  },
): Promise<
  AudiencePreview & {
    announcementName: string;
    channels: EmployeeAnnouncementChannel[];
  }
> {
  const { data: raw, error } = await supabase
    .from("employee_announcements")
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
  const employees = await loadAnnouncementEmployees(
    supabase,
    options.tenantId,
    audience,
  );
  const logins = await loadEmployeeLoginMap(
    supabase,
    options.tenantId,
    employees.map((e) => e.employee_id),
  );
  const preview = previewAudienceResolution({
    employees,
    logins,
    channels,
  });

  return {
    ...preview,
    announcementName: raw.name,
    channels,
  };
}
