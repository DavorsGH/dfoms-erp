"use client";

import { useMemo, useState } from "react";
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
import {
  AUDIENCE_TYPE_OPTIONS,
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
type AudienceType = EmployeeAnnouncementAudienceFilter["type"];

type FormState = {
  name: string;
  contentMode: ContentMode;
  template_id: string;
  subject: string;
  body: string;
  channels: EmployeeAnnouncementChannel[];
  audienceType: AudienceType;
  positionValue: string;
  shiftValue: string;
  employmentTypeValue: string;
  individualIds: string[];
  lockedTemplateName: string | null;
};

const emptyForm: FormState = {
  name: "",
  contentMode: "template",
  template_id: "",
  subject: "",
  body: "",
  channels: ["email"],
  audienceType: "all",
  positionValue: "",
  shiftValue: "",
  employmentTypeValue: "",
  individualIds: [],
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

function statusBadgeTone(
  status: string,
): "slate" | "blue" | "violet" | "emerald" | "amber" | "red" {
  if (status === "draft") return "slate";
  if (status === "sending") return "violet";
  if (status === "sent") return "emerald";
  if (status === "failed") return "red";
  return "amber";
}

function audienceFromForm(form: FormState): EmployeeAnnouncementAudienceFilter {
  if (form.audienceType === "position") {
    return { type: "position", value: form.positionValue.trim() };
  }
  if (form.audienceType === "shift") {
    return { type: "shift", value: form.shiftValue };
  }
  if (form.audienceType === "employment_type") {
    return { type: "employment_type", value: form.employmentTypeValue };
  }
  if (form.audienceType === "individual") {
    return {
      type: "individual",
      value:
        form.individualIds.length === 1
          ? form.individualIds[0]!
          : form.individualIds,
    };
  }
  return { type: "all" };
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

  if (filter.type === "position") {
    return {
      ...base,
      audienceType: "position",
      positionValue: filter.value,
    };
  }
  if (filter.type === "shift") {
    return { ...base, audienceType: "shift", shiftValue: filter.value };
  }
  if (filter.type === "employment_type") {
    return {
      ...base,
      audienceType: "employment_type",
      employmentTypeValue: filter.value,
    };
  }
  if (filter.type === "individual") {
    return {
      ...base,
      audienceType: "individual",
      individualIds: Array.isArray(filter.value)
        ? filter.value
        : [filter.value],
    };
  }
  return { ...base, audienceType: "all" };
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
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [sendStatusMessage, setSendStatusMessage] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [statusFilter, setStatusFilter] = useState("");

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

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Audience
                </label>
                <select
                  disabled={viewOnly}
                  value={form.audienceType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      audienceType: event.target.value as AudienceType,
                    }))
                  }
                  className={inputClassName}
                >
                  {AUDIENCE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {form.audienceType === "position" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Position
                  </label>
                  <select
                    required
                    disabled={viewOnly}
                    value={form.positionValue}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        positionValue: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">Select position</option>
                    {positions.map((position) => (
                      <option key={position.id} value={position.name}>
                        {position.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {form.audienceType === "shift" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Shift
                  </label>
                  <select
                    required
                    disabled={viewOnly}
                    value={form.shiftValue}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        shiftValue: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">Select shift</option>
                    {SHIFT_OPTIONS.map((shift) => (
                      <option key={shift} value={shift}>
                        {shift}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {form.audienceType === "employment_type" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Employment type
                  </label>
                  <select
                    required
                    disabled={viewOnly}
                    value={form.employmentTypeValue}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        employmentTypeValue: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">Select type</option>
                    {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {form.audienceType === "individual" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Employees
                  </label>
                  <select
                    multiple
                    required
                    disabled={viewOnly}
                    value={form.individualIds}
                    onChange={(event) => {
                      const selected = Array.from(
                        event.target.selectedOptions,
                      ).map((option) => option.value);
                      setForm((current) => ({
                        ...current,
                        individualIds: selected,
                      }));
                    }}
                    className={`${inputClassName} min-h-36`}
                  >
                    {employees.map((employee) => (
                      <option
                        key={employee.employee_id}
                        value={employee.employee_id}
                      >
                        {employee.staff_id} — {employee.full_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Hold Ctrl/Cmd to select multiple employees.
                  </p>
                </div>
              ) : null}
            </div>

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
              {viewOnly && editingAnnouncement ? (
                <p className="text-sm text-slate-600">
                  Status:{" "}
                  {formatAnnouncementStatusLabel(editingAnnouncement.status)}.
                  Draft announcements can be edited or deleted; others are
                  view-only.
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
