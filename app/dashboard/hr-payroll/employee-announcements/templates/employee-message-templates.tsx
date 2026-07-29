"use client";

import { useMemo, useState } from "react";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import {
  channelIncludesEmail,
  channelIncludesSms,
  EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS,
  formatChannelLabel,
  validateEmployeeMessageTemplateInput,
  type EmployeeMessageTemplateChannel,
  type EmployeeMessageTemplateRow,
} from "@/utils/employee-message-templates-types";

type EmployeeMessageTemplatesProps = {
  tenantId: string;
  initialTemplates: EmployeeMessageTemplateRow[];
  fetchError: string | null;
};

const emptyForm = {
  name: "",
  channel: "email" as EmployeeMessageTemplateChannel,
  subject: "",
  body: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatUpdatedAt(value: string): string {
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
  tone: "slate" | "emerald" | "amber";
}) {
  const tones: Record<typeof tone, string> = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

export default function EmployeeMessageTemplates({
  tenantId,
  initialTemplates,
  fetchError,
}: EmployeeMessageTemplatesProps) {
  void tenantId;

  const [templates, setTemplates] = useState(initialTemplates);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [channelFilter, setChannelFilter] = useState("");

  const showSubjectField = channelIncludesEmail(form.channel);
  const showSmsHint = channelIncludesSms(form.channel);
  const bodyCharCount = form.body.length;

  const filteredTemplates = useMemo(() => {
    return templates.filter((row) => {
      if (channelFilter && row.channel !== channelFilter) return false;
      return true;
    });
  }, [templates, channelFilter]);

  async function refreshTemplates() {
    const params = new URLSearchParams();
    if (channelFilter) params.set("channel", channelFilter);

    const response = await fetch(
      `/api/employee-message-templates${params.toString() ? `?${params}` : ""}`,
    );
    const payload = (await response.json()) as {
      templates?: EmployeeMessageTemplateRow[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to refresh templates.");
      return;
    }

    setTemplates(payload.templates ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(row: EmployeeMessageTemplateRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      channel: row.channel,
      subject: row.subject ?? "",
      body: row.body,
    });
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const payload = {
      name: form.name,
      channel: form.channel,
      subject: form.subject,
      body: form.body,
    };

    const clientValidation = validateEmployeeMessageTemplateInput(payload);
    if (clientValidation) {
      setError(clientValidation);
      return;
    }

    setLoading(true);

    const response = await fetch(
      editingId
        ? `/api/employee-message-templates/${editingId}`
        : "/api/employee-message-templates",
      {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Failed to save template.");
      setLoading(false);
      return;
    }

    closeForm();
    await refreshTemplates();
    setLoading(false);
  }

  async function handleDeactivate(row: EmployeeMessageTemplateRow) {
    if (
      !window.confirm(
        `Deactivate template “${row.name}”? It will be hidden from the list but kept for history.`,
      )
    ) {
      return;
    }

    setDeactivatingId(row.id);
    setError(null);

    const response = await fetch(`/api/employee-message-templates/${row.id}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? "Failed to deactivate template.");
      setDeactivatingId(null);
      return;
    }

    if (editingId === row.id) {
      closeForm();
    }

    await refreshTemplates();
    setDeactivatingId(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Channel
          </label>
          <select
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="">All channels</option>
            {EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {formatChannelLabel(channel)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => (showForm && !editingId ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm && !editingId ? "Cancel" : "Add Template"}
        </button>
      </div>

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h4 className="mb-4 text-base font-semibold text-[#0f2744]">
            {editingId ? "Edit Template" : "New Template"}
          </h4>
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Name
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="e.g. Payroll notice"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Channel
                </label>
                <select
                  required
                  value={form.channel}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      channel: event.target
                        .value as EmployeeMessageTemplateChannel,
                    }))
                  }
                  className={inputClassName}
                >
                  {EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {formatChannelLabel(channel)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {showSubjectField ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Subject
                </label>
                <input
                  required
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
                {showSmsHint ? (
                  <span className="text-xs text-slate-500">
                    {bodyCharCount} character{bodyCharCount === 1 ? "" : "s"}
                    {bodyCharCount > 160
                      ? ` · ~${Math.ceil(bodyCharCount / 160)} segments`
                      : ""}
                  </span>
                ) : null}
              </div>
              <textarea
                required
                rows={showSmsHint && !showSubjectField ? 4 : 6}
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

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
              >
                {loading ? "Saving…" : editingId ? "Save changes" : "Create template"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
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
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Channel</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Updated</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No active templates yet.
                  </td>
                </tr>
              ) : (
                filteredTemplates.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={formatChannelLabel(row.channel)}
                        tone={
                          row.channel === "both"
                            ? "amber"
                            : row.channel === "sms"
                              ? "emerald"
                              : "slate"
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.is_active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatUpdatedAt(row.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <RegisterRowActions
                        onEdit={() => openEditForm(row)}
                        onDelete={() => void handleDeactivate(row)}
                        disableEdit={deactivatingId === row.id}
                        disableDelete={deactivatingId === row.id}
                      />
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
