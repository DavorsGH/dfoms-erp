"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";
import { getStripedRowClassName } from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import TemplatePlaceholderReference from "@/components/template-placeholder-reference";
import {
  EMPLOYEE_ANNOUNCEMENT_CHANNELS,
  EMPLOYEE_ANNOUNCEMENT_STATUSES,
  formatAnnouncementChannelLabel,
  formatAnnouncementStatusLabel,
  formatAudienceLabel,
  formatChannelsLabel,
  isDraftStatus,
  validateEmployeeAnnouncementInput,
  type EmployeeAnnouncementAudienceFilter,
  type EmployeeAnnouncementChannel,
  type NormalizedEmployeeAnnouncementRow,
} from "@/utils/employee-announcements-types";
import {
  formatChannelLabel,
  type EmployeeMessageTemplateRow,
} from "@/utils/employee-message-templates-types";
import { EMPLOYEE_TEMPLATE_PLACEHOLDERS } from "@/utils/message-template-placeholders";
import { substituteTemplatePlaceholders } from "@/utils/message-template-render";

export type AnnouncementEmployeeOption = {
  employee_id: string;
  staff_id: string;
  full_name: string;
};

export type AnnouncementPositionOption = {
  id: string;
  name: string;
};

type EmployeeAnnouncementsCampaignsProps = {
  tenantId: string;
  initialAnnouncements: NormalizedEmployeeAnnouncementRow[];
  activeTemplates: EmployeeMessageTemplateRow[];
  positions: AnnouncementPositionOption[];
  employees: AnnouncementEmployeeOption[];
  fetchError: string | null;
};

type ContentMode = "template" | "adhoc";
type AudienceMode = "all" | "filtered";

type FormState = {
  name: string;
  contentMode: ContentMode;
  template_id: string;
  subject: string;
  body: string;
  channels: EmployeeAnnouncementChannel[];
  audienceMode: AudienceMode;
  positions: string[];
  shifts: string[];
  employmentTypes: string[];
  individualIds: string[];
  individualSearch: string;
  lockedTemplateName: string | null;
};

type AnnouncementRecipientDetail = {
  id: string;
  employee_id: string;
  channel: string;
  status: string;
  sent_at: string | null;
  error_detail: string | null;
  employee_name: string;
  staff_id: string | null;
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
  positions: [],
  shifts: [],
  employmentTypes: [],
  individualIds: [],
  individualSearch: "",
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
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
}

function audienceFromForm(form: FormState): EmployeeAnnouncementAudienceFilter {
  if (form.audienceMode === "all") {
    return { type: "all" };
  }
  return {
    type: "filtered",
    positions: form.positions,
    shifts: form.shifts,
    employment_types: form.employmentTypes,
    employee_ids: form.individualIds,
  };
}

function formFromAnnouncement(
  row: NormalizedEmployeeAnnouncementRow,
): FormState {
  const filter = row.audience_filter;
  const base: FormState = {
    ...emptyForm,
    name: row.name,
    contentMode: row.template_id ? "template" : "adhoc",
    template_id: row.template_id ?? "",
    subject: row.subject ?? "",
    body: row.body ?? "",
    channels: row.channels.length > 0 ? row.channels : ["email"],
    lockedTemplateName: row.employee_message_templates?.name ?? null,
  };

  if (filter.type === "filtered") {
    return {
      ...base,
      audienceMode: "filtered",
      positions: filter.positions,
      shifts: filter.shifts,
      employmentTypes: filter.employment_types,
      individualIds: filter.employee_ids,
    };
  }

  return { ...base, audienceMode: "all" };
}

function toggleChannel(
  current: EmployeeAnnouncementChannel[],
  channel: EmployeeAnnouncementChannel,
): EmployeeAnnouncementChannel[] {
  if (current.includes(channel)) {
    return current.filter((item) => item !== channel);
  }
  return EMPLOYEE_ANNOUNCEMENT_CHANNELS.filter(
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
    employee_name: "Employee Name",
    staff_id: "DF0000",
    employee_id: "EMP0000",
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
          <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-800 whitespace-pre-wrap">
            {resolvedBody}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">No message body.</p>
        )}
        <p className="text-xs text-slate-400">
          Placeholders resolved using{" "}
          {sampleVariables
            ? "a real recipient from this send"
            : "sample values (no recipients yet)"}
          .
        </p>
      </div>
    </div>
  );
}

export default function EmployeeAnnouncementsCampaigns({
  tenantId,
  initialAnnouncements,
  activeTemplates,
  positions,
  employees,
  fetchError,
}: EmployeeAnnouncementsCampaignsProps) {
  void tenantId;

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

    fetch(`/api/employee-announcements/${editingId}/recipients`)
      .then((response) => response.json())
      .then((payload: AnnouncementDetailPayload) => {
        if (cancelled) return;
        setViewDetail(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setViewDetail({
          recipients: [],
          content: null,
          sample_variables: null,
          error: "Failed to load announcement details.",
        });
      })
      .finally(() => {
        if (!cancelled) setViewDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewOnly, editingId]);

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
    return employees
      .filter((employee) => {
        if (form.individualIds.includes(employee.employee_id)) return false;
        const hay = `${employee.full_name} ${employee.staff_id} ${employee.employee_id}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [employees, form.individualIds, form.individualSearch]);

  const selectedIndividuals = useMemo(
    () =>
      form.individualIds
        .map((id) => employees.find((e) => e.employee_id === id))
        .filter(Boolean) as AnnouncementEmployeeOption[],
    [employees, form.individualIds],
  );

  async function refreshAnnouncements() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);

    const response = await fetch(
      `/api/employee-announcements${params.toString() ? `?${params}` : ""}`,
    );
    const payload = (await response.json()) as {
      announcements?: NormalizedEmployeeAnnouncementRow[];
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

  function openEditForm(row: NormalizedEmployeeAnnouncementRow) {
    if (!isDraftStatus(row.status)) return;
    setEditingId(row.id);
    setViewOnly(false);
    setForm(formFromAnnouncement(row));
    setShowForm(true);
    setError(null);
  }

  function openViewForm(row: NormalizedEmployeeAnnouncementRow) {
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
      name: form.name.trim(),
      template_id:
        form.contentMode === "template" ? form.template_id || null : null,
      channels: form.channels,
      subject: form.contentMode === "adhoc" ? form.subject : null,
      body: form.contentMode === "adhoc" ? form.body : null,
      audience_filter: audienceFromForm(form),
    };

    const clientValidation = validateEmployeeAnnouncementInput(payload);
    if (clientValidation) {
      setError(clientValidation);
      return;
    }

    setLoading(true);

    const response = await fetch(
      editingId
        ? `/api/employee-announcements/${editingId}`
        : "/api/employee-announcements",
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

  async function handleDelete(row: NormalizedEmployeeAnnouncementRow) {
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

    const response = await fetch(`/api/employee-announcements/${row.id}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Failed to delete announcement.");
      setDeletingId(null);
      return;
    }

    if (editingId === row.id) {
      closeForm();
    }

    await refreshAnnouncements();
    setDeletingId(null);
  }

  async function executeSend(announcementId: string) {
    setSendingId(announcementId);
    setError(null);
    setSendStatusMessage(null);

    const response = await fetch(
      `/api/employee-announcements/${announcementId}/send`,
      { method: "POST" },
    );
    const payload = (await response.json()) as {
      result?: {
        status: string;
        message: string;
        pendingRemaining: number;
        sent: number;
        failed: number;
        skippedNoContact: number;
        skippedNoLogin: number;
        totalRecipients: number;
      };
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

  async function confirmAndSendDraft(row: NormalizedEmployeeAnnouncementRow) {
    setPreviewLoadingId(row.id);
    setError(null);

    const previewResponse = await fetch(
      `/api/employee-announcements/${row.id}/audience-preview`,
    );
    const previewPayload = (await previewResponse.json()) as {
      preview?: {
        employeeCount: number;
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
        `Employees in audience: ${preview.employeeCount}\n` +
        `Eligible deliveries: ${preview.pendingCount}\n` +
        `No contact (email/phone): ${preview.skippedNoContactCount}\n` +
        `No login (in-app): ${preview.skippedNoLoginCount}\n\n` +
        `Sends are processed in batches of up to 50. Continue?`,
    );

    if (!confirmed) return;
    await executeSend(row.id);
  }

  async function continueSending(row: NormalizedEmployeeAnnouncementRow) {
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
            {EMPLOYEE_ANNOUNCEMENT_STATUSES.map((status) => (
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
                placeholder="e.g. July payroll notice"
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
                  {templates.length === 0 && !viewOnly ? (
                    <p className="mt-1 text-xs text-amber-700">
                      No active templates. Create one under Templates first.
                    </p>
                  ) : null}
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
                        placeholder="Email subject line"
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
                      placeholder="Hello {{employee_name}}, ..."
                    />
                    <TemplatePlaceholderReference
                      placeholders={EMPLOYEE_TEMPLATE_PLACEHOLDERS}
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
              <p className="mb-2 text-sm font-medium text-slate-700">
                Channels
              </p>
              <div className="flex flex-wrap gap-4">
                {EMPLOYEE_ANNOUNCEMENT_CHANNELS.map((channel) => (
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
                        positions: [],
                        shifts: [],
                        employmentTypes: [],
                        individualIds: [],
                        individualSearch: "",
                      }))
                    }
                  />
                  All employees
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
                  Filtered (union of criteria + named people)
                </label>
              </div>

              {form.audienceMode === "filtered" ? (
                <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">
                    Recipients are the union of everyone matching any selected
                    position, shift, or employment type, plus anyone added by
                    name — duplicates are removed automatically.
                  </p>

                  <div className="grid gap-4 md:grid-cols-3">
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">
                        Positions
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {positions.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No positions configured.
                          </p>
                        ) : (
                          positions.map((position) => (
                            <label
                              key={position.id}
                              className="flex items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                disabled={viewOnly}
                                checked={form.positions.includes(position.name)}
                                onChange={() =>
                                  setForm((current) => ({
                                    ...current,
                                    positions: toggleListValue(
                                      current.positions,
                                      position.name,
                                    ),
                                  }))
                                }
                              />
                              {position.name}
                            </label>
                          ))
                        )}
                      </div>
                    </fieldset>

                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">
                        Shifts
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {SHIFT_OPTIONS.map((shift) => (
                          <label
                            key={shift}
                            className="flex items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              disabled={viewOnly}
                              checked={form.shifts.includes(shift)}
                              onChange={() =>
                                setForm((current) => ({
                                  ...current,
                                  shifts: toggleListValue(
                                    current.shifts,
                                    shift,
                                  ),
                                }))
                              }
                            />
                            {shift}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">
                        Employment types
                      </legend>
                      <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
                          <label
                            key={type}
                            className="flex items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              disabled={viewOnly}
                              checked={form.employmentTypes.includes(type)}
                              onChange={() =>
                                setForm((current) => ({
                                  ...current,
                                  employmentTypes: toggleListValue(
                                    current.employmentTypes,
                                    type,
                                  ),
                                }))
                              }
                            />
                            {type}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Named individuals
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
                          placeholder="Search by name or staff ID…"
                        />
                        {individualSearchMatches.length > 0 ? (
                          <ul className="rounded border border-slate-200 bg-white">
                            {individualSearchMatches.map((employee) => (
                              <li key={employee.employee_id}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                                  onClick={() =>
                                    setForm((current) => ({
                                      ...current,
                                      individualIds: [
                                        ...current.individualIds,
                                        employee.employee_id,
                                      ],
                                      individualSearch: "",
                                    }))
                                  }
                                >
                                  <span className="font-medium text-slate-900">
                                    {employee.full_name}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {employee.staff_id}
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
                        {selectedIndividuals.map((employee) => (
                          <span
                            key={employee.employee_id}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-800 ring-1 ring-slate-200"
                          >
                            {employee.full_name}
                            {!viewOnly ? (
                              <button
                                type="button"
                                className="ml-1 text-slate-500 hover:text-red-600"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    individualIds: current.individualIds.filter(
                                      (id) => id !== employee.employee_id,
                                    ),
                                  }))
                                }
                                aria-label={`Remove ${employee.full_name}`}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No named individuals added.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {viewOnly && editingAnnouncement ? (
              <div className="space-y-5 border-t border-slate-200 pt-4">
                <div>
                  <h5 className="mb-2 text-sm font-semibold text-[#0f2744]">
                    Recipients
                  </h5>
                  {viewDetailLoading ? (
                    <p className="text-sm text-slate-500">Loading recipients…</p>
                  ) : viewDetail?.error ? (
                    <p className="text-sm text-red-600">{viewDetail.error}</p>
                  ) : isDraftStatus(editingAnnouncement.status) &&
                    (!viewDetail?.recipients ||
                      viewDetail.recipients.length === 0) ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Recipients will be shown once this announcement is sent.
                    </p>
                  ) : viewDetail?.recipients &&
                    viewDetail.recipients.length > 0 ? (
                    <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-100 text-xs font-medium uppercase tracking-wider text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Employee</th>
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
                                {r.employee_name}
                                {r.staff_id ? (
                                  <span className="ml-2 text-xs font-normal text-slate-500">
                                    {r.staff_id}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  label={formatAnnouncementChannelLabel(
                                    r.channel,
                                  )}
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

                {viewDetail?.content ? (
                  <AnnouncementMessagePreview
                    content={viewDetail.content}
                    sampleVariables={viewDetail.sample_variables}
                  />
                ) : viewDetailLoading ? null : (
                  <p className="text-sm text-slate-500">
                    Message content not available.
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
                    ? "Counting audience…"
                    : sendingId === editingAnnouncement.id
                      ? "Sending…"
                      : "Send"}
                </button>
              ) : null}
              {canContinueSending && editingAnnouncement ? (
                <button
                  type="button"
                  disabled={sendingId === editingAnnouncement.id}
                  onClick={() => void continueSending(editingAnnouncement)}
                  className="rounded-md bg-violet-700 px-5 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {sendingId === editingAnnouncement.id
                    ? "Sending…"
                    : "Continue Sending"}
                </button>
              ) : null}
              {viewOnly && editingAnnouncement?.status === "sent" ? (
                <p className="text-sm text-slate-600">
                  Sent — {editingAnnouncement.total_recipients} recipient
                  {editingAnnouncement.total_recipients === 1 ? "" : "s"}{" "}
                  recorded.
                </p>
              ) : null}
              {viewOnly && editingAnnouncement?.status === "sending" ? (
                <p className="text-sm text-slate-600">
                  Sending in progress. Use Continue Sending for the next batch.
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
                    No announcements yet.
                  </td>
                </tr>
              ) : (
                filteredAnnouncements.map((row, index) => {
                  const draft = isDraftStatus(row.status);
                  const sending = row.status === "sending";

                  return (
                    <tr key={row.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-mono text-sm text-slate-800">
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          {draft ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditForm(row)}
                                disabled={
                                  deletingId === row.id || sendingId === row.id
                                }
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={
                                  sendingId === row.id ||
                                  previewLoadingId === row.id ||
                                  deletingId === row.id
                                }
                                onClick={() => void confirmAndSendDraft(row)}
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {previewLoadingId === row.id
                                  ? "…"
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
                                disabled={sendingId === row.id}
                                onClick={() => void continueSending(row)}
                                className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-900 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
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

      <p className="text-xs text-slate-500">
        Tip: only draft announcements can be edited or deleted. Sends run in
        batches of up to 50 — use Continue Sending when status is Sending.
      </p>
    </div>
  );
}
