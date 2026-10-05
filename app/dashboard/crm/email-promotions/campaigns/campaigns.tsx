"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { getStripedRowClassName } from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import TemplatePlaceholderReference from "@/components/template-placeholder-reference";
import SmsBodyCounter from "@/components/sms-body-counter";
import {
  AUDIENCE_CUSTOMER_TYPE_OPTIONS,
  campaignChannelFlags,
  campaignChannelFromFlags,
  defaultChannelFromTemplate,
  formatCampaignChannelListLabel,
  filteredCampaignAudienceHasCriteria,
  formatAudienceLabel,
  formatCampaignStatusLabel,
  isDraftStatus,
  type CampaignAudienceCustomerType,
  type CampaignAudienceFilter,
  type CampaignChannel,
  type NormalizedCampaignRow,
} from "@/utils/campaigns-types";
import {
  channelIncludesEmail,
  channelIncludesSms,
  formatChannelLabel,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";
import { CUSTOMER_TEMPLATE_PLACEHOLDERS } from "@/utils/message-template-placeholders";
import { substituteTemplatePlaceholders } from "@/utils/message-template-render";
import CampaignSendConfirmDialog, {
  type CampaignSendPreviewStats,
} from "./campaign-send-confirm-dialog";

type CampaignRecipientDetail = {
  id: string;
  customer_id: string;
  channel: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  customer_name: string;
  email: string | null;
  phone: string | null;
};

type CampaignTemplateDetail = {
  name: string;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
  channel: string;
};

type CampaignDetailPayload = {
  recipients: CampaignRecipientDetail[];
  template: CampaignTemplateDetail | null;
  error?: string;
};

type AudienceCustomerOption = {
  client_id: string;
  client_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

type CampaignsProps = {
  tenantId: string;
  initialCampaigns: NormalizedCampaignRow[];
  activeTemplates: MessageTemplateRow[];
  audienceCustomers: AudienceCustomerOption[];
  fetchError: string | null;
};

type AudienceMode = "all" | "filtered";
type ContentMode = "template" | "adhoc";

type FormState = {
  name: string;
  contentMode: ContentMode;
  template_id: string;
  subject: string;
  body: string;
  channelEmail: boolean;
  channelSms: boolean;
  audienceMode: AudienceMode;
  customerTypes: CampaignAudienceCustomerType[];
  individualIds: string[];
  individualSearch: string;
  lockedChannel: CampaignChannel | null;
  lockedTemplateName: string | null;
};

const emptyForm: FormState = {
  name: "",
  contentMode: "template",
  template_id: "",
  subject: "",
  body: "",
  channelEmail: true,
  channelSms: false,
  audienceMode: "all",
  customerTypes: [],
  individualIds: [],
  individualSearch: "",
  lockedChannel: null,
  lockedTemplateName: null,
};

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "blue" | "violet" | "slate" | "emerald" | "amber" | "red";
}) {
  const tones: Record<typeof tone, string> = {
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    red: "bg-red-50 text-red-800 ring-red-200",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

function channelBadgeTone(
  channel: string,
): "blue" | "emerald" | "amber" | "slate" {
  if (channel === "both") return "amber";
  if (channel === "sms") return "emerald";
  if (channel === "email") return "blue";
  return "slate";
}

function statusBadgeTone(
  status: string,
): "slate" | "blue" | "violet" | "emerald" | "amber" | "red" {
  if (status === "draft") return "slate";
  if (status === "scheduled") return "blue";
  if (status === "sending") return "violet";
  if (status === "sent") return "emerald";
  if (status === "failed") return "red";
  return "amber";
}

function recipientStatusBadgeTone(
  status: string,
): "emerald" | "red" | "amber" | "slate" | "violet" {
  if (status === "sent" || status === "delivered") return "emerald";
  if (status === "failed" || status === "bounced") return "red";
  if (status === "skipped_opted_out") return "amber";
  if (status === "pending") return "violet";
  return "slate";
}

function formatRecipientStatus(status: string): string {
  if (status === "skipped_opted_out") return "Opted Out";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSentAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toggleListValue(list: string[], value: string): string[] {
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
}

function audienceFromForm(form: FormState): CampaignAudienceFilter {
  if (form.audienceMode === "all") {
    return { type: "all" };
  }
  return {
    type: "filtered",
    customer_types: form.customerTypes,
    client_ids: form.individualIds,
  };
}

function customerDisplayName(customer: AudienceCustomerOption): string {
  return (
    customer.client_name?.trim() ||
    customer.contact_person?.trim() ||
    customer.client_id
  );
}

function customerContactHint(customer: AudienceCustomerOption): string {
  const parts: string[] = [];
  if (customer.phone?.trim()) parts.push(customer.phone.trim());
  if (customer.email?.trim()) parts.push(customer.email.trim());
  return parts.length > 0 ? parts.join(" · ") : customer.client_id;
}

function formFromCampaign(row: NormalizedCampaignRow): FormState {
  const filter = row.audience_filter;
  const channelFlags = campaignChannelFlags(row.channel);
  const locked = {
    lockedChannel: row.channel,
    lockedTemplateName: row.message_templates?.name ?? null,
  };
  const base = {
    name: row.name,
    contentMode: row.template_id ? ("template" as const) : ("adhoc" as const),
    template_id: row.template_id ?? "",
    subject: row.subject ?? "",
    body: (row.body_email ?? row.body_sms ?? "").trim(),
    channelEmail: channelFlags.email,
    channelSms: channelFlags.sms,
    individualSearch: "",
    ...locked,
  };
  if (filter.type === "filtered") {
    return {
      ...base,
      audienceMode: "filtered",
      customerTypes: filter.customer_types,
      individualIds: filter.client_ids,
    };
  }
  if (filter.type === "customer_type") {
    return {
      ...base,
      audienceMode: "filtered",
      customerTypes: [filter.value],
      individualIds: [],
    };
  }
  return {
    ...base,
    audienceMode: "all",
    customerTypes: [],
    individualIds: [],
  };
}

function CampaignMessagePreview({
  template,
  campaignChannel,
}: {
  template: CampaignTemplateDetail;
  campaignChannel: CampaignChannel;
}) {
  // Render with sample placeholder values so the user sees the template shape.
  const sampleVars: Record<string, string> = {
    first_name: "Ama",
    full_name: "Ama Owusu",
    company_name: "Central University",
    email: "customer@example.com",
    phone: "0244123456",
    business_name: "Your Business",
    customer_name: "Central University",
    contact_person: "Ama Owusu",
    client_id: "CLI000",
  };

  const showEmail =
    campaignChannel !== "sms" && channelIncludesEmail(template.channel);
  const showSms =
    campaignChannel !== "email" && channelIncludesSms(template.channel);

  const resolvedSubject = template.subject
    ? substituteTemplatePlaceholders(template.subject, sampleVars)
    : null;
  const resolvedEmailBody = template.body_email
    ? substituteTemplatePlaceholders(template.body_email, sampleVars)
    : null;
  const resolvedSmsBody = template.body_sms
    ? substituteTemplatePlaceholders(template.body_sms, sampleVars)
    : null;

  return (
    <div>
      <h5 className="mb-2 text-sm font-semibold text-[#0f2744]">Message</h5>
      <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
        {showEmail ? (
          <div className="space-y-1">
            {resolvedSubject ? (
              <p className="text-sm">
                <span className="font-medium text-slate-700">Subject: </span>
                <span className="text-slate-900">{resolvedSubject}</span>
              </p>
            ) : null}
            {resolvedEmailBody ? (
              <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-800 whitespace-pre-wrap">
                {resolvedEmailBody}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">
                No email body content.
              </p>
            )}
          </div>
        ) : null}
        {showSms ? (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              SMS
            </p>
            {resolvedSmsBody ? (
              <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-800 whitespace-pre-wrap">
                {resolvedSmsBody}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">
                No SMS body content.
              </p>
            )}
          </div>
        ) : null}
        {!showEmail && !showSms ? (
          <p className="text-sm text-slate-500 italic">
            No message content available for this channel.
          </p>
        ) : null}
        <p className="text-xs text-slate-400">
          Variables like {"{{customer_name}}"} are shown with placeholder
          values.
        </p>
      </div>
    </div>
  );
}

export default function Campaigns({
  tenantId,
  initialCampaigns,
  activeTemplates,
  audienceCustomers,
  fetchError,
}: CampaignsProps) {
  void tenantId;

  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [templates] = useState(activeTemplates);
  const [customers] = useState(audienceCustomers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [sendConfirm, setSendConfirm] = useState<{
    campaignId: string;
    campaignName: string;
    preview: CampaignSendPreviewStats;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [sendStatusMessage, setSendStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [statusFilter, setStatusFilter] = useState("");

  // View Campaign detail: recipients + resolved message.
  const [viewDetail, setViewDetail] = useState<CampaignDetailPayload | null>(
    null,
  );
  const [viewDetailLoading, setViewDetailLoading] = useState(false);

  useEffect(() => {
    if (!viewOnly || !editingId) {
      setViewDetail(null);
      return;
    }

    let cancelled = false;
    setViewDetailLoading(true);

    fetch(`/api/campaigns/${editingId}/recipients`)
      .then((response) => response.json())
      .then((payload: CampaignDetailPayload) => {
        if (cancelled) return;
        setViewDetail(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setViewDetail({ recipients: [], template: null, error: "Failed to load campaign details." });
      })
      .finally(() => {
        if (!cancelled) setViewDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewOnly, editingId]);

  const editingCampaign = useMemo(
    () => (editingId ? campaigns.find((row) => row.id === editingId) ?? null : null),
    [campaigns, editingId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((row) => row.id === form.template_id) ?? null,
    [templates, form.template_id],
  );

  const derivedChannel: CampaignChannel | null =
    campaignChannelFromFlags({
      email: form.channelEmail,
      sms: form.channelSms,
    }) ?? form.lockedChannel;

  const showEmailFields =
    form.contentMode === "adhoc" &&
    form.channelEmail &&
    Boolean(derivedChannel && derivedChannel !== "sms");
  const showAdhocSmsBody =
    form.contentMode === "adhoc" &&
    form.channelSms &&
    Boolean(derivedChannel && derivedChannel !== "email");

  const filteredCampaigns = useMemo(() => {
    if (!statusFilter) return campaigns;
    return campaigns.filter((row) => row.status === statusFilter);
  }, [campaigns, statusFilter]);

  async function refreshCampaigns() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);

    const response = await fetch(
      `/api/campaigns${params.toString() ? `?${params}` : ""}`,
    );
    const payload = (await response.json()) as {
      campaigns?: NormalizedCampaignRow[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to refresh campaigns.");
      return;
    }

    setCampaigns(payload.campaigns ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setViewOnly(false);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(row: NormalizedCampaignRow) {
    setEditingId(row.id);
    setViewOnly(false);
    setForm(formFromCampaign(row));
    setShowForm(true);
    setError(null);
  }

  function openViewForm(row: NormalizedCampaignRow) {
    setEditingId(row.id);
    setViewOnly(true);
    setForm(formFromCampaign(row));
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setViewOnly(false);
    setForm(emptyForm);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (viewOnly) return;

    setError(null);

    if (!form.name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (!derivedChannel) {
      setError("Select at least one channel (Email and/or SMS).");
      return;
    }
    if (form.contentMode === "template" && !form.template_id) {
      setError("Select a message template.");
      return;
    }
    if (form.contentMode === "adhoc") {
      if (derivedChannel !== "sms" && !form.subject.trim()) {
        setError("Email campaigns require a subject line.");
        return;
      }
      if (!form.body.trim()) {
        setError("Enter a message body.");
        return;
      }
    }

    if (form.audienceMode === "filtered") {
      const draftAudience = audienceFromForm(form);
      if (
        draftAudience.type === "filtered" &&
        !filteredCampaignAudienceHasCriteria(draftAudience)
      ) {
        setError(
          "Select at least one customer type or add at least one customer by name.",
        );
        return;
      }
    }

    const adhocBody = form.body.trim();
    const payload = {
      name: form.name.trim(),
      template_id: form.contentMode === "template" ? form.template_id : null,
      channel: derivedChannel,
      subject: form.contentMode === "adhoc" ? form.subject.trim() : null,
      body_email:
        form.contentMode === "adhoc" &&
        (derivedChannel === "email" || derivedChannel === "both")
          ? adhocBody
          : null,
      body_sms:
        form.contentMode === "adhoc" &&
        (derivedChannel === "sms" || derivedChannel === "both")
          ? adhocBody
          : null,
      audience_filter: audienceFromForm(form),
    };

    setLoading(true);

    const response = await fetch(
      editingId ? `/api/campaigns/${editingId}` : "/api/campaigns",
      {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Failed to save campaign.");
      setLoading(false);
      return;
    }

    closeForm();
    await refreshCampaigns();
    setLoading(false);
  }

  async function handleDelete(row: NormalizedCampaignRow) {
    if (
      !(await confirmDialog({
        message: `Delete draft campaign “${row.name}”? This cannot be undone.`,
        tone: "danger",
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }

    setDeletingId(row.id);
    setError(null);

    const response = await fetch(`/api/campaigns/${row.id}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Failed to delete campaign.");
      setDeletingId(null);
      return;
    }

    if (editingId === row.id) {
      closeForm();
    }

    await refreshCampaigns();
    setDeletingId(null);
  }

  async function executeSend(campaignId: string) {
    setSendingId(campaignId);
    setError(null);
    setSendStatusMessage(null);

    const response = await fetch(`/api/campaigns/${campaignId}/send`, {
      method: "POST",
    });
    const payload = (await response.json()) as {
      result?: {
        status: string;
        message: string;
        pendingRemaining: number;
        sent: number;
        failed: number;
        skippedOptedOut: number;
        totalRecipients: number;
      };
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to send campaign.");
      setSendingId(null);
      return;
    }

    setSendStatusMessage(payload.result?.message ?? "Send batch completed.");
    await refreshCampaigns();
    setSendingId(null);
  }

  async function confirmAndSendDraft(row: NormalizedCampaignRow) {
    setPreviewLoadingId(row.id);
    setError(null);

    const previewResponse = await fetch(
      `/api/campaigns/${row.id}/audience-preview`,
    );
    const previewPayload = (await previewResponse.json()) as {
      preview?: CampaignSendPreviewStats & {
        pendingCount: number;
        skippedOptedOutCount: number;
        missingContactCount: number;
      };
      error?: string;
    };

    setPreviewLoadingId(null);

    if (!previewResponse.ok || !previewPayload.preview) {
      setError(previewPayload.error ?? "Failed to preview audience.");
      return;
    }

    const preview = previewPayload.preview;
    setSendConfirm({
      campaignId: row.id,
      campaignName: row.name,
      preview: {
        customerCount: preview.customerCount,
        eligibleEmailCount: preview.eligibleEmailCount ?? 0,
        eligibleSmsCount: preview.eligibleSmsCount ?? 0,
        skippedOptedOutEmailCount: preview.skippedOptedOutEmailCount ?? 0,
        skippedOptedOutSmsCount: preview.skippedOptedOutSmsCount ?? 0,
        missingEmailCount: preview.missingEmailCount ?? 0,
        missingPhoneCount: preview.missingPhoneCount ?? 0,
      },
    });
  }

  async function continueSending(row: NormalizedCampaignRow) {
    await executeSend(row.id);
  }

  const formTitle = viewOnly
    ? "View Campaign"
    : editingId
      ? "Edit Campaign"
      : "New Campaign";

  const individualSearchMatches = useMemo(() => {
    const q = form.individualSearch.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((customer) => {
        if (form.individualIds.includes(customer.client_id)) return false;
        const hay = [
          customer.client_name,
          customer.contact_person,
          customer.phone,
          customer.email,
          customer.client_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [customers, form.individualIds, form.individualSearch]);

  const selectedIndividuals = useMemo(
    () =>
      form.individualIds
        .map((id) => customers.find((c) => c.client_id === id))
        .filter(Boolean) as AudienceCustomerOption[],
    [customers, form.individualIds],
  );

  const canSendDraft =
    Boolean(editingCampaign) &&
    isDraftStatus(editingCampaign!.status) &&
    !viewOnly;
  const canContinueSending =
    Boolean(editingCampaign) && editingCampaign!.status === "sending";

  return (
    <div className="min-w-0 space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {sendStatusMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {sendStatusMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshCampaigns()}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => (showForm && !editingId ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm && !editingId ? "Cancel" : "New Campaign"}
          </button>
        </div>
      </div>

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h4 className="mb-4 text-base font-semibold text-[#0f2744]">
            {formTitle}
          </h4>
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
          >
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Name
              </label>
              <input
                required
                disabled={viewOnly}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className={inputClassName}
                placeholder="e.g. March promo blast"
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Content</p>
              <div className="mb-3 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="campaignContentMode"
                    disabled={viewOnly}
                    checked={form.contentMode === "template"}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        contentMode: "template",
                      }))
                    }
                  />
                  Use template
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="campaignContentMode"
                    disabled={viewOnly}
                    checked={form.contentMode === "adhoc"}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        contentMode: "adhoc",
                        template_id: "",
                      }))
                    }
                  />
                  Ad-hoc message
                </label>
              </div>

              {form.contentMode === "template" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Template
                  </label>
                  <select
                    required
                    disabled={viewOnly}
                    value={form.template_id}
                    onChange={(event) => {
                      const templateId = event.target.value;
                      const template = templates.find((row) => row.id === templateId);
                      const suggested = template
                        ? campaignChannelFlags(
                            defaultChannelFromTemplate(template.channel),
                          )
                        : { email: true, sms: false };
                      setForm((current) => ({
                        ...current,
                        template_id: templateId,
                        lockedChannel: null,
                        lockedTemplateName: null,
                        channelEmail: suggested.email,
                        channelSms: suggested.sms,
                      }));
                    }}
                    className={inputClassName}
                  >
                    <option value="">Select an active template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({formatChannelLabel(template.channel)})
                      </option>
                    ))}
                    {viewOnly &&
                    form.template_id &&
                    !templates.some((t) => t.id === form.template_id) ? (
                      <option value={form.template_id}>
                        {form.lockedTemplateName ?? "Inactive template"}
                      </option>
                    ) : null}
                  </select>
                  {templates.length === 0 && !viewOnly ? (
                    <p className="mt-1 text-xs text-amber-700">
                      No active templates. Create one under Templates first.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  {showEmailFields ? (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Subject
                      </label>
                      <input
                        required
                        disabled={viewOnly}
                        value={form.subject}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            subject: event.target.value,
                          }))
                        }
                        className={inputClassName}
                        placeholder="Email subject line"
                      />
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <label className="block text-sm font-medium text-slate-700">
                        Body
                      </label>
                      {showAdhocSmsBody ? (
                        <SmsBodyCounter body={form.body} />
                      ) : null}
                    </div>
                    <textarea
                      ref={bodyTextareaRef}
                      required
                      disabled={viewOnly}
                      rows={5}
                      value={form.body}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          body: event.target.value,
                        }))
                      }
                      className={inputClassName}
                      placeholder="Hello {{first_name}}, ..."
                    />
                    <TemplatePlaceholderReference
                      placeholders={CUSTOMER_TEMPLATE_PLACEHOLDERS}
                      value={form.body}
                      onChange={(next) =>
                        setForm((current) => ({ ...current, body: next }))
                      }
                      textareaRef={bodyTextareaRef}
                      disabled={viewOnly}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Channels</p>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    disabled={viewOnly}
                    checked={form.channelEmail}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        channelEmail: !current.channelEmail,
                      }))
                    }
                  />
                  Email
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    disabled={viewOnly}
                    checked={form.channelSms}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        channelSms: !current.channelSms,
                      }))
                    }
                  />
                  SMS
                </label>
              </div>
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Audience
              </span>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="audienceMode"
                    disabled={viewOnly}
                    checked={form.audienceMode === "all"}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        audienceMode: "all",
                        customerTypes: [],
                        individualIds: [],
                        individualSearch: "",
                      }))
                    }
                  />
                  All customers
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="audienceMode"
                    disabled={viewOnly}
                    checked={form.audienceMode === "filtered"}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        audienceMode: "filtered",
                      }))
                    }
                  />
                  Filtered (union of criteria + named customers)
                </label>
              </div>

              {form.audienceMode === "filtered" ? (
                <div className="mt-4 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">
                    Recipients are the union of everyone matching any selected
                    customer type, plus anyone added by name — duplicates are
                    removed automatically.
                  </p>

                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-slate-700">
                      Customer types
                    </legend>
                    <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                      {AUDIENCE_CUSTOMER_TYPE_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            disabled={viewOnly}
                            checked={form.customerTypes.includes(
                              option.value as CampaignAudienceCustomerType,
                            )}
                            onChange={() =>
                              setForm((current) => ({
                                ...current,
                                customerTypes: toggleListValue(
                                  current.customerTypes,
                                  option.value,
                                ) as CampaignAudienceCustomerType[],
                              }))
                            }
                          />
                          {option.value === "all"
                            ? "All (multi-type customers)"
                            : option.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Named customers
                    </label>
                    {!viewOnly ? (
                      <div className="space-y-2">
                        <input
                          value={form.individualSearch}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              individualSearch: event.target.value,
                            }))
                          }
                          className={inputClassName}
                          placeholder="Search by name, phone, email, or customer ID…"
                        />
                        {individualSearchMatches.length > 0 ? (
                          <ul className="rounded border border-slate-200 bg-white">
                            {individualSearchMatches.map((customer) => (
                              <li key={customer.client_id}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                                  onClick={() =>
                                    setForm((current) => ({
                                      ...current,
                                      individualIds: [
                                        ...current.individualIds,
                                        customer.client_id,
                                      ],
                                      individualSearch: "",
                                    }))
                                  }
                                >
                                  <span className="font-medium text-slate-900">
                                    {customerDisplayName(customer)}
                                  </span>
                                  <span className="shrink-0 text-xs text-slate-500">
                                    {customerContactHint(customer)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedIndividuals.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedIndividuals.map((customer) => (
                          <span
                            key={customer.client_id}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-800 ring-1 ring-slate-200"
                          >
                            {customerDisplayName(customer)}
                            {!viewOnly ? (
                              <button
                                type="button"
                                className="ml-1 text-slate-500 hover:text-red-600"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    individualIds: current.individualIds.filter(
                                      (id) => id !== customer.client_id,
                                    ),
                                  }))
                                }
                                aria-label={`Remove ${customerDisplayName(customer)}`}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Search and add individual customers, or select types
                        above.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {viewOnly && editingCampaign ? (
                <p className="mt-2 text-xs text-slate-600">
                  {formatAudienceLabel(editingCampaign.audience_filter)}
                </p>
              ) : null}
            </div>

            {/* ── View-only: Recipients table + Message preview ── */}
            {viewOnly && editingCampaign ? (
              <div className="space-y-5">
                {/* Recipients */}
                <div>
                  <h5 className="mb-2 text-sm font-semibold text-[#0f2744]">
                    Recipients
                  </h5>
                  {viewDetailLoading ? (
                    <p className="text-sm text-slate-500">Loading recipients…</p>
                  ) : viewDetail?.error ? (
                    <p className="text-sm text-red-600">{viewDetail.error}</p>
                  ) : isDraftStatus(editingCampaign.status) &&
                    (!viewDetail?.recipients ||
                      viewDetail.recipients.length === 0) ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Recipients will be shown once this campaign is sent.
                    </p>
                  ) : viewDetail?.recipients &&
                    viewDetail.recipients.length > 0 ? (
                    <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-100 text-xs font-medium uppercase tracking-wider text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">
                              {editingCampaign.channel === "sms"
                                ? "Phone"
                                : "Email"}
                            </th>
                            <th className="px-3 py-2">Channel</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Sent At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {viewDetail.recipients.map((r, i) => (
                            <tr
                              key={r.id}
                              className={
                                i % 2 === 1 ? "bg-slate-50" : "bg-white"
                              }
                            >
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {r.customer_name}
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                {r.channel === "sms"
                                  ? r.phone ?? "—"
                                  : r.email ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  label={formatChannelLabel(r.channel)}
                                  tone={channelBadgeTone(r.channel)}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  label={formatRecipientStatus(r.status)}
                                  tone={recipientStatusBadgeTone(r.status)}
                                />
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {formatSentAt(r.sent_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      No recipients recorded.
                    </p>
                  )}
                </div>

                {/* Message Preview */}
                {viewDetail?.template ? (
                  <CampaignMessagePreview
                    template={viewDetail.template}
                    campaignChannel={editingCampaign.channel}
                  />
                ) : viewDetailLoading ? null : (
                  <p className="text-sm text-slate-500">
                    Template content not available.
                  </p>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {!viewOnly ? (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save Draft"}
                </button>
              ) : null}
              {canSendDraft && editingCampaign ? (
                <button
                  type="button"
                  disabled={
                    sendingId === editingCampaign.id ||
                    previewLoadingId === editingCampaign.id
                  }
                  onClick={() => void confirmAndSendDraft(editingCampaign)}
                  className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {previewLoadingId === editingCampaign.id
                    ? "Counting audience…"
                    : sendingId === editingCampaign.id
                      ? "Sending…"
                      : "Send"}
                </button>
              ) : null}
              {canContinueSending && editingCampaign ? (
                <button
                  type="button"
                  disabled={sendingId === editingCampaign.id}
                  onClick={() => void continueSending(editingCampaign)}
                  className="rounded-md bg-violet-700 px-5 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {sendingId === editingCampaign.id
                    ? "Sending…"
                    : "Continue Sending"}
                </button>
              ) : null}
              {viewOnly && editingCampaign?.status === "sent" ? (
                <p className="text-sm text-slate-600">
                  Sent — {editingCampaign.total_recipients} recipient
                  {editingCampaign.total_recipients === 1 ? "" : "s"} recorded.
                </p>
              ) : null}
              {viewOnly && editingCampaign?.status === "sending" ? (
                <p className="text-sm text-slate-600">
                  Sending in progress. Use Continue Sending for the next batch,
                  or Refresh the list.
                </p>
              ) : null}
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {viewOnly ? "Close" : "Cancel"}
              </button>
            </div>

          </form>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Campaign Code</th>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Channel</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Template</th>
                <th className={scrollableTableThClassName}>Recipients</th>
                <th className={scrollableTableThClassName}>Created</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No campaigns yet.
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((row, index) => {
                  const draft = isDraftStatus(row.status);
                  const sending = row.status === "sending";
                  const templateName =
                    row.message_templates?.name ?? "—";

                  return (
                    <tr key={row.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-mono text-sm text-slate-800">
                        {row.campaign_code ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {row.name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          label={formatCampaignChannelListLabel(row.channel)}
                          tone={channelBadgeTone(row.channel)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          label={formatCampaignStatusLabel(row.status)}
                          tone={statusBadgeTone(row.status)}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {templateName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.total_recipients}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatCreatedAt(row.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          {draft ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditForm(row)}
                                disabled={deletingId === row.id}
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void confirmAndSendDraft(row)}
                                disabled={
                                  sendingId === row.id ||
                                  previewLoadingId === row.id
                                }
                                className="rounded-md border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {previewLoadingId === row.id
                                  ? "Counting…"
                                  : sendingId === row.id
                                    ? "Sending…"
                                    : "Send"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(row)}
                                disabled={deletingId === row.id}
                                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {deletingId === row.id ? "Deleting…" : "Delete"}
                              </button>
                            </>
                          ) : sending ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openViewForm(row)}
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => void continueSending(row)}
                                disabled={sendingId === row.id}
                                className="rounded-md border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {sendingId === row.id
                                  ? "Sending…"
                                  : "Continue Sending"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openViewForm(row)}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              View
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      {filteredCampaigns.length > 0 && statusFilter === "" ? (
        <p className="text-xs text-slate-500">
          Tip: draft campaigns can be edited or deleted. Once a campaign moves
          past draft, use View to inspect it.
        </p>
      ) : null}

      {sendConfirm ? (
        <CampaignSendConfirmDialog
          campaignName={sendConfirm.campaignName}
          preview={sendConfirm.preview}
          confirming={sendingId === sendConfirm.campaignId}
          onCancel={() => setSendConfirm(null)}
          onConfirm={() => {
            const id = sendConfirm.campaignId;
            setSendConfirm(null);
            void executeSend(id);
          }}
        />
      ) : null}
    </div>
  );
}
