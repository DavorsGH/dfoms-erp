"use client";

import { useState } from "react";
import { formatChannelLabel } from "@/utils/message-templates-types";
import type { MessageTemplateRow } from "@/utils/message-templates-types";
import {
  TRANSACTIONAL_EVENT_LABELS,
  defaultChannelFromTemplate,
  type TransactionalNotificationRuleRow,
} from "@/utils/transactional-notification-types";

type NotificationRulesProps = {
  tenantId: string;
  initialRules: TransactionalNotificationRuleRow[];
  transactionalTemplates: MessageTemplateRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type DraftState = {
  template_id: string;
  is_active: boolean;
};

export default function NotificationRules({
  tenantId,
  initialRules,
  transactionalTemplates,
  fetchError,
}: NotificationRulesProps) {
  void tenantId;

  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>(() => {
    const initial: Record<string, DraftState> = {};
    for (const rule of initialRules) {
      initial[rule.event_type] = {
        template_id: rule.template_id ?? "",
        is_active: rule.is_active,
      };
    }
    return initial;
  });
  const [savingEvent, setSavingEvent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  function updateDraft(
    eventType: string,
    patch: Partial<DraftState>,
  ) {
    setDrafts((current) => ({
      ...current,
      [eventType]: {
        template_id: current[eventType]?.template_id ?? "",
        is_active: current[eventType]?.is_active ?? false,
        ...patch,
      },
    }));
  }

  async function handleSave(eventType: string) {
    const draft = drafts[eventType];
    if (!draft?.template_id) {
      setError("Pick a transactional template before saving.");
      return;
    }

    const template = transactionalTemplates.find(
      (row) => row.id === draft.template_id,
    );
    if (!template) {
      setError("Selected template is not available.");
      return;
    }

    setSavingEvent(eventType);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/notification-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        template_id: draft.template_id,
        channel: defaultChannelFromTemplate(template.channel),
        is_active: draft.is_active,
      }),
    });

    const payload = (await response.json()) as {
      rules?: TransactionalNotificationRuleRow[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to save notification rule.");
      setSavingEvent(null);
      return;
    }

    if (payload.rules) {
      setRules(payload.rules);
      const nextDrafts: Record<string, DraftState> = {};
      for (const rule of payload.rules) {
        nextDrafts[rule.event_type] = {
          template_id: rule.template_id ?? "",
          is_active: rule.is_active,
        };
      }
      setDrafts(nextDrafts);
    }

    setSuccess(`${TRANSACTIONAL_EVENT_LABELS[eventType as keyof typeof TRANSACTIONAL_EVENT_LABELS] ?? eventType} saved.`);
    setSavingEvent(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Automatic customer messages for operational events. These are not
        marketing campaigns and are not gated by marketing opt-out preferences.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      {transactionalTemplates.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active transactional templates yet. Create one under Templates
          (type = Transactional) before enabling a rule.
        </p>
      ) : null}

      <div className="space-y-4">
        {rules.map((rule) => {
          const draft = drafts[rule.event_type] ?? {
            template_id: "",
            is_active: false,
          };
          const selectedTemplate = transactionalTemplates.find(
            (row) => row.id === draft.template_id,
          );
          const derivedChannel = selectedTemplate
            ? defaultChannelFromTemplate(selectedTemplate.channel)
            : rule.channel;
          const canEnable = Boolean(draft.template_id);
          const label = TRANSACTIONAL_EVENT_LABELS[rule.event_type];

          return (
            <section
              key={rule.event_type}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-[#0f2744]">
                    {label}
                  </h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Event key: <code>{rule.event_type}</code>
                  </p>
                </div>
                {!rule.configured ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    Not configured
                  </span>
                ) : rule.is_active ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                    Enabled
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                    Disabled
                  </span>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Template
                  </label>
                  <select
                    value={draft.template_id}
                    onChange={(event) => {
                      const templateId = event.target.value;
                      updateDraft(rule.event_type, {
                        template_id: templateId,
                        is_active: templateId ? draft.is_active : false,
                      });
                    }}
                    className={inputClassName}
                  >
                    <option value="">Select transactional template</option>
                    {transactionalTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({formatChannelLabel(template.channel)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Channel
                  </label>
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {derivedChannel
                      ? formatChannelLabel(derivedChannel)
                      : "— (select a template)"}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Enabled
                  </label>
                  <label
                    className={`mt-1 inline-flex items-center gap-2 text-sm ${
                      canEnable ? "text-slate-800" : "text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={canEnable ? draft.is_active : false}
                      disabled={!canEnable}
                      onChange={(event) =>
                        updateDraft(rule.event_type, {
                          is_active: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                    />
                    {canEnable
                      ? draft.is_active
                        ? "On"
                        : "Off"
                      : "Pick a template first"}
                  </label>
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  disabled={savingEvent === rule.event_type || !draft.template_id}
                  onClick={() => void handleSave(rule.event_type)}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                >
                  {savingEvent === rule.event_type ? "Saving…" : "Save"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
