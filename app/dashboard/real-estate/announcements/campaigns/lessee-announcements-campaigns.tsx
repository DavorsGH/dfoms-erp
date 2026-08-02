"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStripedRowClassName } from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import TemplatePlaceholderReference from "@/components/template-placeholder-reference";
import {
  LESSEE_ANNOUNCEMENT_CHANNELS,
  LESSEE_ANNOUNCEMENT_STATUSES,
  formatAnnouncementChannelLabel,
  formatAnnouncementStatusLabel,
  formatAudienceLabel,
  formatChannelsLabel,
  isDraftStatus,
  validateLesseeAnnouncementInput,
  type LesseeAnnouncementAudienceFilter,
  type LesseeAnnouncementChannel,
  type NormalizedLesseeAnnouncementRow,
} from "@/utils/lessee-announcements-types";
import {
  formatChannelLabel,
  type LesseeMessageTemplateRow,
} from "@/utils/lessee-message-templates-types";
import { LESSEE_TEMPLATE_PLACEHOLDERS } from "@/utils/message-template-placeholders";
import { substituteTemplatePlaceholders } from "@/utils/message-template-render";

export type AnnouncementLesseeOption = {
  lessee_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

export type AnnouncementPropertyOption = {
  property_id: string;
  name: string;
};

export type AnnouncementLeaseOption = {
  lease_id: string;
  label: string;
  lessee_id: string;
  property_id: string | null;
};

type LesseeAnnouncementsCampaignsProps = {
  tenantId: string;
  initialAnnouncements: NormalizedLesseeAnnouncementRow[];
  activeTemplates: LesseeMessageTemplateRow[];
  properties: AnnouncementPropertyOption[];
  leases: AnnouncementLeaseOption[];
  lessees: AnnouncementLesseeOption[];
  fetchError: string | null;
  /** Defaults to staff admin announcements API. */
  apiBasePath?: string;
};

type ContentMode = "template" | "adhoc";
type AudienceMode = "all" | "filtered";

type FormState = {
  name: string;
  contentMode: ContentMode;
  template_id: string;
  subject: string;
  body: string;
  channels: LesseeAnnouncementChannel[];
  audienceMode: AudienceMode;
  propertyIds: string[];
  leaseIds: string[];
  individualIds: string[];
  individualSearch: string;
  lockedTemplateName: string | null;
};

type AnnouncementRecipientDetail = {
  id: string;
  lessee_id: string;
  channel: string;
  status: string;
  sent_at: string | null;
  error_detail: string | null;
  lessee_name: string;
  email: string | null;
  phone: string | null;
};

type AnnouncementDetailPayload = {
  recipients: AnnouncementRecipientDetail[];
  content: {
    template_name: string | null;
    subject: string | null;
    body: string;
    channels: string[];
  } | null;
  sample_variables: Record<string, string> | null;
  error?: string;
};

const emptyForm: FormState = {
  name: "",
  contentMode: "template",
  template_id: "",
  subject: "",
  body: "",
  channels: ["email"],
  audienceMode: "all",
  propertyIds: [],
  leaseIds: [],
  individualIds: [],
  individualSearch: "",
  lockedTemplateName: null,
};

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

function formatRecipientStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function statusBadgeTone(
  status: string,
): "slate" | "blue" | "violet" | "emerald" | "amber" | "red" {
  if (status === "draft") return "slate";
  if (status === "sending") return "violet";
  if (status === "sent") return "emerald";
  if (status === "failed") return "red";
  return "amber";
}

function channelBadgeTone(
  channel: string,
): "blue" | "emerald" | "violet" | "slate" {
  if (channel === "sms") return "emerald";
  if (channel === "email") return "blue";
  if (channel === "in_app") return "violet";
  return "slate";
}

function recipientStatusBadgeTone(
  status: string,
): "emerald" | "red" | "amber" | "slate" {
  if (status === "sent") return "emerald";
  if (status === "failed") return "red";
  if (status.startsWith("skipped_")) return "amber";
  return "slate";
}

function toggleListValue(list: string[], value: string): string[] {
  if (list.includes(value)) return list.filter((item) => item !== value);
  return [...list, value];
}

function audienceFromForm(form: FormState): LesseeAnnouncementAudienceFilter {
  if (form.audienceMode === "all") return { type: "all" };
  return {
    type: "filtered",
    property_ids: form.propertyIds,
    lease_ids: form.leaseIds,
    lessee_ids: form.individualIds,
  };
}

function formFromAnnouncement(row: NormalizedLesseeAnnouncementRow): FormState {
  const filter = row.audience_filter;
  const base: FormState = {
    ...emptyForm,
    name: row.name,
    contentMode: row.template_id ? "template" : "adhoc",
    template_id: row.template_id ?? "",
    subject: row.subject ?? "",
    body: row.body ?? "",
    channels: row.channels.length > 0 ? row.channels : ["email"],
    lockedTemplateName: row.lessee_message_templates?.name ?? null,
  };

  if (filter.type === "filtered") {
    return {
      ...base,
      audienceMode: "filtered",
      propertyIds: filter.property_ids,
      leaseIds: filter.lease_ids,
      individualIds: filter.lessee_ids,
    };
  }

  return { ...base, audienceMode: "all" };
}

function toggleChannel(
  current: LesseeAnnouncementChannel[],
  channel: LesseeAnnouncementChannel,
): LesseeAnnouncementChannel[] {
  if (current.includes(channel)) {
    return current.filter((item) => item !== channel);
  }
  return LESSEE_ANNOUNCEMENT_CHANNELS.filter(
    (item) => item === channel || current.includes(item),
  );
}

function AnnouncementMessagePreview({
  content,
  sampleVariables,
}: {
  content: NonNullable<AnnouncementDetailPayload["content"]>;
  sampleVariables: Record<string, string> | null;
}) {
  const vars = sampleVariables ?? {
    tenant_name: "Tenant Name",
    property_name: "Property",
    unit_number: "A1",
  };
  const resolvedSubject = content.subject
    ? substituteTemplatePlaceholders(content.subject, vars)
    : null;
  const resolvedBody = content.body
    ? substituteTemplatePlaceholders(content.body, vars)
    : "";

  return (
    <div>
      <h5 className="mb-2 text-sm font-semibold text-[#0f2744]">Message</h5>
      <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
        {content.template_name ? (
          <p className="text-xs text-slate-500">
            Template: {content.template_name}
          </p>
        ) : null}
        {resolvedSubject ? (
          <p className="text-sm">
            <span className="font-medium text-slate-700">Subject: </span>
            <span className="text-slate-900">{resolvedSubject}</span>
          </p>
        ) : null}
        {resolvedBody ? (
          <div className="rounded border border-slate-200 bg-white p-3 text-sm whitespace-pre-wrap text-slate-800">
            {resolvedBody}
          </div>
        ) : (
          <p className="text-sm italic text-slate-500">No message body.</p>
        )}
      </div>
    </div>
  );
}

export default function LesseeAnnouncementsCampaigns({
  tenantId,
  initialAnnouncements,
  activeTemplates,
  properties,
  leases,
  lessees,
  fetchError,
  apiBasePath = "/api/admin/lessee-announcements",
}: LesseeAnnouncementsCampaignsProps) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [templates] = useState(activeTemplates);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [sendStatusMessage, setSendStatusMessage] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [statusFilter, setStatusFilter] = useState("");
  const [viewDetail, setViewDetail] = useState<AnnouncementDetailPayload | null>(
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

    fetch(
      `${apiBasePath}/${editingId}/recipients?tenant_id=${encodeURIComponent(tenantId)}`,
    )
      .then((response) => response.json())
      .then((payload: AnnouncementDetailPayload) => {
        if (!cancelled) setViewDetail(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setViewDetail({
            recipients: [],
            content: null,
            sample_variables: null,
            error: "Failed to load announcement details.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setViewDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewOnly, editingId, tenantId]);

  const editingAnnouncement = useMemo(
    () =>
      editingId
        ? (announcements.find((row) => row.id === editingId) ?? null)
        : null,
    [announcements, editingId],
  );

  const filteredAnnouncements = useMemo(() => {
    if (!statusFilter) return announcements;
    return announcements.filter((row) => row.status === statusFilter);
  }, [announcements, statusFilter]);

  const showSubjectField =
    form.contentMode === "adhoc" && form.channels.includes("email");

  const individualSearchMatches = useMemo(() => {
    const q = form.individualSearch.trim().toLowerCase();
    if (!q) return [];
    return lessees
      .filter((lessee) => {
        if (form.individualIds.includes(lessee.lessee_id)) return false;
        const hay =
          `${lessee.full_name} ${lessee.email ?? ""} ${lessee.phone ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [lessees, form.individualIds, form.individualSearch]);

  const selectedIndividuals = useMemo(
    () =>
      form.individualIds
        .map((id) => lessees.find((l) => l.lessee_id === id))
        .filter(Boolean) as AnnouncementLesseeOption[],
    [lessees, form.individualIds],
  );

  async function refreshAnnouncements() {
    const params = new URLSearchParams({ tenant_id: tenantId });
    if (statusFilter) params.set("status", statusFilter);

    const response = await fetch(
      `${apiBasePath}?${params}`,
    );
    const payload = (await response.json()) as {
      announcements?: NormalizedLesseeAnnouncementRow[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to refresh announcements.");
      return;
    }

    setAnnouncements(payload.announcements ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setViewOnly(false);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(row: NormalizedLesseeAnnouncementRow) {
    if (!isDraftStatus(row.status)) return;
    setEditingId(row.id);
    setViewOnly(false);
    setForm(formFromAnnouncement(row));
    setShowForm(true);
    setError(null);
  }

  function openViewForm(row: NormalizedLesseeAnnouncementRow) {
    setEditingId(row.id);
    setViewOnly(true);
    setForm(formFromAnnouncement(row));
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

    const payload = {
      tenant_id: tenantId,
      name: form.name.trim(),
      template_id:
        form.contentMode === "template" ? form.template_id || null : null,
      channels: form.channels,
      subject: form.contentMode === "adhoc" ? form.subject : null,
      body: form.contentMode === "adhoc" ? form.body : null,
      audience_filter: audienceFromForm(form),
    };

    const clientValidation = validateLesseeAnnouncementInput(payload);
    if (clientValidation) {
      setError(clientValidation);
      return;
    }

    setLoading(true);

    const response = await fetch(
      editingId
        ? `${apiBasePath}/${editingId}`
        : apiBasePath,
      {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Failed to save announcement.");
      setLoading(false);
      return;
    }

    closeForm();
    await refreshAnnouncements();
    setLoading(false);
  }

  async function handleDelete(row: NormalizedLesseeAnnouncementRow) {
    if (!isDraftStatus(row.status)) return;
    if (
      !window.confirm(
        `Delete draft announcement “${row.name}”? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(row.id);
    setError(null);

    const response = await fetch(
      `${apiBasePath}/${row.id}?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: "DELETE" },
    );
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Failed to delete announcement.");
      setDeletingId(null);
      return;
    }

    if (editingId === row.id) closeForm();
    await refreshAnnouncements();
    setDeletingId(null);
  }

  async function executeSend(announcementId: string) {
    setSendingId(announcementId);
    setError(null);
    setSendStatusMessage(null);

    const response = await fetch(
      `${apiBasePath}/${announcementId}/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      },
    );
    const payload = (await response.json()) as {
      result?: { message: string };
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to send announcement.");
      setSendingId(null);
      return;
    }

    setSendStatusMessage(payload.result?.message ?? "Send batch completed.");
    await refreshAnnouncements();
    setSendingId(null);
  }

  async function confirmAndSendDraft(row: NormalizedLesseeAnnouncementRow) {
    setPreviewLoadingId(row.id);
    setError(null);

    const previewResponse = await fetch(
      `${apiBasePath}/${row.id}/audience-preview?tenant_id=${encodeURIComponent(tenantId)}`,
    );
    const previewPayload = (await previewResponse.json()) as {
      preview?: {
        lesseeCount: number;
        pendingCount: number;
        skippedNoContactCount: number;
        skippedNoLoginCount: number;
      };
      error?: string;
    };

    setPreviewLoadingId(null);

    if (!previewResponse.ok || !previewPayload.preview) {
      setError(previewPayload.error ?? "Failed to preview audience.");
      return;
    }

    const preview = previewPayload.preview;
    const confirmed = window.confirm(
      `Send announcement “${row.name}”?\n\n` +
        `Tenants in audience: ${preview.lesseeCount}\n` +
        `Eligible deliveries: ${preview.pendingCount}\n` +
        `No contact (email/phone): ${preview.skippedNoContactCount}\n` +
        `No portal login (in-app): ${preview.skippedNoLoginCount}\n\n` +
        `Sends are processed in batches of up to 50. Continue?`,
    );

    if (!confirmed) return;
    await executeSend(row.id);
  }

  const formTitle = viewOnly
    ? "View Announcement"
    : editingId
      ? "Edit Announcement"
      : "New Announcement";

  const canSendDraft =
    Boolean(editingAnnouncement) &&
    isDraftStatus(editingAnnouncement!.status) &&
    !viewOnly;
  const canContinueSending =
    Boolean(editingAnnouncement) &&
    editingAnnouncement!.status === "sending";

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
            {LESSEE_ANNOUNCEMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatAnnouncementStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshAnnouncements()}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              showForm && !editingId ? closeForm() : openAddForm()
            }
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
                placeholder="e.g. Building A water notice"
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Content</p>
              <div className="mb-3 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="contentMode"
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
                    name="contentMode"
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
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        template_id: event.target.value,
                        lockedTemplateName: null,
                      }))
                    }
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
                </div>
              ) : (
                <div className="space-y-4">
                  {showSubjectField ? (
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
                      />
                    </div>
                  ) : null}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Body
                    </label>
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
                      placeholder="Hello {{tenant_name}}, ..."
                    />
                    <TemplatePlaceholderReference
                      placeholders={LESSEE_TEMPLATE_PLACEHOLDERS}
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
                {LESSEE_ANNOUNCEMENT_CHANNELS.map((channel) => (
                  <label
                    key={channel}
                    className="inline-flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      disabled={viewOnly}
                      checked={form.channels.includes(channel)}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          channels: toggleChannel(current.channels, channel),
                        }))
                      }
                    />
                    {formatAnnouncementChannelLabel(channel)}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Audience</p>
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
                        propertyIds: [],
                        leaseIds: [],
                        individualIds: [],
                        individualSearch: "",
                      }))
                    }
                  />
                  All tenants
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
                  Filtered (union of properties, leases/units, named tenants)
                </label>
              </div>

              {form.audienceMode === "filtered" ? (
                <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">
                    Recipients are the union of tenants on selected properties
                    (active leases), selected leases/units, and named
                    individuals — duplicates removed automatically.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">
                        Properties
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {properties.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No properties for this landlord.
                          </p>
                        ) : (
                          properties.map((property) => (
                            <label
                              key={property.property_id}
                              className="flex items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                disabled={viewOnly}
                                checked={form.propertyIds.includes(
                                  property.property_id,
                                )}
                                onChange={() =>
                                  setForm((current) => ({
                                    ...current,
                                    propertyIds: toggleListValue(
                                      current.propertyIds,
                                      property.property_id,
                                    ),
                                  }))
                                }
                              />
                              {property.name}
                            </label>
                          ))
                        )}
                      </div>
                    </fieldset>

                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">
                        Leases / units
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {leases.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No active leases for this landlord.
                          </p>
                        ) : (
                          leases.map((lease) => (
                            <label
                              key={lease.lease_id}
                              className="flex items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                disabled={viewOnly}
                                checked={form.leaseIds.includes(lease.lease_id)}
                                onChange={() =>
                                  setForm((current) => ({
                                    ...current,
                                    leaseIds: toggleListValue(
                                      current.leaseIds,
                                      lease.lease_id,
                                    ),
                                  }))
                                }
                              />
                              {lease.label}
                            </label>
                          ))
                        )}
                      </div>
                    </fieldset>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Named tenants
                    </label>
                    {!viewOnly ? (
                      <input
                        value={form.individualSearch}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            individualSearch: event.target.value,
                          }))
                        }
                        className={inputClassName}
                        placeholder="Search by name, email, or phone"
                      />
                    ) : null}
                    {individualSearchMatches.length > 0 ? (
                      <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
                        {individualSearchMatches.map((lessee) => (
                          <li key={lessee.lessee_id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                              onClick={() =>
                                setForm((current) => ({
                                  ...current,
                                  individualIds: [
                                    ...current.individualIds,
                                    lessee.lessee_id,
                                  ],
                                  individualSearch: "",
                                }))
                              }
                            >
                              {lessee.full_name}
                              {lessee.email ? (
                                <span className="text-slate-500">
                                  {" "}
                                  · {lessee.email}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {selectedIndividuals.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {selectedIndividuals.map((lessee) => (
                          <li
                            key={lessee.lessee_id}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-slate-200"
                          >
                            {lessee.full_name}
                            {!viewOnly ? (
                              <button
                                type="button"
                                className="text-slate-500 hover:text-red-600"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    individualIds: current.individualIds.filter(
                                      (id) => id !== lessee.lessee_id,
                                    ),
                                  }))
                                }
                              >
                                ×
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {viewOnly ? (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                {viewDetailLoading ? (
                  <p className="text-sm text-slate-500">Loading details…</p>
                ) : null}
                {viewDetail?.error ? (
                  <p className="text-sm text-red-700">{viewDetail.error}</p>
                ) : null}
                {viewDetail?.content ? (
                  <AnnouncementMessagePreview
                    content={viewDetail.content}
                    sampleVariables={viewDetail.sample_variables}
                  />
                ) : null}
                {viewDetail && viewDetail.recipients.length > 0 ? (
                  <div>
                    <h5 className="mb-2 text-sm font-semibold text-[#0f2744]">
                      Delivery rows ({viewDetail.recipients.length})
                    </h5>
                    <ScrollableTable>
                      <table className={scrollableTableClassName}>
                        <thead className={scrollableTableHeadClassName}>
                          <tr>
                            <th className={scrollableTableThClassName}>
                              Tenant
                            </th>
                            <th className={scrollableTableThClassName}>
                              Channel
                            </th>
                            <th className={scrollableTableThClassName}>
                              Status
                            </th>
                            <th className={scrollableTableThClassName}>Sent</th>
                            <th className={scrollableTableThClassName}>
                              Detail
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {viewDetail.recipients.map((row, index) => (
                            <tr
                              key={row.id}
                              className={getStripedRowClassName(index)}
                            >
                              <td className="px-4 py-2 text-sm text-slate-900">
                                {row.lessee_name}
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  label={formatAnnouncementChannelLabel(
                                    row.channel,
                                  )}
                                  tone={channelBadgeTone(row.channel)}
                                />
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  label={formatRecipientStatus(row.status)}
                                  tone={recipientStatusBadgeTone(row.status)}
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-slate-700">
                                {formatSentAt(row.sent_at)}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-500">
                                {row.error_detail ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollableTable>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {!viewOnly ? (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                >
                  {loading
                    ? "Saving…"
                    : editingId
                      ? "Save draft"
                      : "Create draft"}
                </button>
              ) : null}
              {canSendDraft && editingAnnouncement ? (
                <button
                  type="button"
                  disabled={
                    sendingId === editingAnnouncement.id ||
                    previewLoadingId === editingAnnouncement.id
                  }
                  onClick={() => void confirmAndSendDraft(editingAnnouncement)}
                  className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {previewLoadingId === editingAnnouncement.id
                    ? "Previewing…"
                    : sendingId === editingAnnouncement.id
                      ? "Sending…"
                      : "Send"}
                </button>
              ) : null}
              {canContinueSending && editingAnnouncement ? (
                <button
                  type="button"
                  disabled={sendingId === editingAnnouncement.id}
                  onClick={() => void executeSend(editingAnnouncement.id)}
                  className="rounded-md bg-violet-700 px-5 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {sendingId === editingAnnouncement.id
                    ? "Sending…"
                    : "Continue Sending"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
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
                <th className={scrollableTableThClassName}>Code</th>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Channels</th>
                <th className={scrollableTableThClassName}>Audience</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Recipients</th>
                <th className={scrollableTableThClassName}>Created</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAnnouncements.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No campaigns yet for this landlord.
                  </td>
                </tr>
              ) : (
                filteredAnnouncements.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.announcement_code ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatChannelsLabel(row.channels)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatAudienceLabel(row.audience_filter)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={formatAnnouncementStatusLabel(row.status)}
                        tone={statusBadgeTone(row.status)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.total_recipients}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatCreatedAt(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openViewForm(row)}
                          className="text-xs font-medium text-[#0f2744] hover:underline"
                        >
                          View
                        </button>
                        {isDraftStatus(row.status) ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditForm(row)}
                              className="text-xs font-medium text-[#0f2744] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={
                                sendingId === row.id ||
                                previewLoadingId === row.id
                              }
                              onClick={() => void confirmAndSendDraft(row)}
                              className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                            >
                              Send
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === row.id}
                              onClick={() => void handleDelete(row)}
                              className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                        {row.status === "sending" ? (
                          <button
                            type="button"
                            disabled={sendingId === row.id}
                            onClick={() => void executeSend(row.id)}
                            className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-50"
                          >
                            Continue
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
