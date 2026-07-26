"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import {
  AUDIENCE_CUSTOMER_TYPE_OPTIONS,
  AUDIENCE_TYPE_OPTIONS,
  defaultChannelFromTemplate,
  formatCampaignStatusLabel,
  isDraftStatus,
  type CampaignAudienceFilter,
  type CampaignChannel,
  type NormalizedCampaignRow,
} from "@/utils/campaigns-types";
import {
  formatChannelLabel,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";

type CampaignsProps = {
  tenantId: string;
  initialCampaigns: NormalizedCampaignRow[];
  activeTemplates: MessageTemplateRow[];
  fetchError: string | null;
};

type AudienceType = "all" | "customer_type";

type FormState = {
  name: string;
  template_id: string;
  audienceType: AudienceType;
  customerType: "service_client" | "digital_subscriber" | "both";
  /** Fallback when viewing a non-draft whose template is no longer active. */
  lockedChannel: CampaignChannel | null;
  lockedTemplateName: string | null;
};

const emptyForm: FormState = {
  name: "",
  template_id: "",
  audienceType: "all",
  customerType: "service_client",
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

function audienceFromForm(form: FormState): CampaignAudienceFilter {
  if (form.audienceType === "customer_type") {
    return { type: "customer_type", value: form.customerType };
  }
  return { type: "all" };
}

function formFromCampaign(row: NormalizedCampaignRow): FormState {
  const filter = row.audience_filter;
  const locked = {
    lockedChannel: row.channel,
    lockedTemplateName: row.message_templates?.name ?? null,
  };
  if (filter.type === "customer_type") {
    return {
      name: row.name,
      template_id: row.template_id,
      audienceType: "customer_type",
      customerType: filter.value,
      ...locked,
    };
  }
  return {
    name: row.name,
    template_id: row.template_id,
    audienceType: "all",
    customerType: "service_client",
    ...locked,
  };
}

export default function Campaigns({
  tenantId,
  initialCampaigns,
  activeTemplates,
  fetchError,
}: CampaignsProps) {
  void tenantId;

  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [templates] = useState(activeTemplates);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [sendStatusMessage, setSendStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [statusFilter, setStatusFilter] = useState("");

  const editingCampaign = useMemo(
    () => (editingId ? campaigns.find((row) => row.id === editingId) ?? null : null),
    [campaigns, editingId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((row) => row.id === form.template_id) ?? null,
    [templates, form.template_id],
  );

  const derivedChannel: CampaignChannel | null = selectedTemplate
    ? defaultChannelFromTemplate(selectedTemplate.channel)
    : form.lockedChannel;

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
    if (!form.template_id) {
      setError("Select a message template.");
      return;
    }
    if (!derivedChannel) {
      setError("Selected template is not available.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      template_id: form.template_id,
      channel: derivedChannel,
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
      !window.confirm(
        `Delete draft campaign “${row.name}”? This cannot be undone.`,
      )
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
      preview?: {
        customerCount: number;
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
    const confirmed = window.confirm(
      `Send campaign “${row.name}”?\n\n` +
        `Customers in audience: ${preview.customerCount}\n` +
        `Eligible deliveries: ${preview.pendingCount}\n` +
        `Opted out (will be recorded as skipped): ${preview.skippedOptedOutCount}\n` +
        `Missing email/phone (skipped, not recorded): ${preview.missingContactCount}\n\n` +
        `Sends are processed in batches of up to 50. Continue?`,
    );

    if (!confirmed) return;
    await executeSend(row.id);
  }

  async function continueSending(row: NormalizedCampaignRow) {
    await executeSend(row.id);
  }

  const formTitle = viewOnly
    ? "View Campaign"
    : editingId
      ? "Edit Campaign"
      : "New Campaign";

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
            <div className="grid gap-4 md:grid-cols-2">
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
                      lockedChannel: null,
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
                      {form.lockedTemplateName ?? "Inactive template"} (
                      {form.lockedChannel
                        ? formatChannelLabel(form.lockedChannel)
                        : "—"})
                    </option>
                  ) : null}
                </select>
                {templates.length === 0 && !viewOnly ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No active templates. Create one under Templates first.
                  </p>
                ) : null}
              </div>
            </div>

            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Channel:{" "}
              <span className="font-medium text-slate-900">
                {derivedChannel
                  ? formatChannelLabel(derivedChannel)
                  : "— (select a template)"}
              </span>
            </p>

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
              {form.audienceType === "customer_type" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Customer type
                  </label>
                  <select
                    disabled={viewOnly}
                    value={form.customerType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        customerType: event.target.value as FormState["customerType"],
                      }))
                    }
                    className={inputClassName}
                  >
                    {AUDIENCE_CUSTOMER_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
                          label={formatChannelLabel(row.channel)}
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
    </div>
  );
}
