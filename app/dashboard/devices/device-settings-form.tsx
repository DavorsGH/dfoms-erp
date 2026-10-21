"use client";

import { useEffect, useState } from "react";
import DashboardButton from "@/components/dashboard-button";
import TimePickerField from "@/components/time-picker-field";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import {
  saveTenantDeviceSettings,
  useTenantDeviceSettings,
} from "@/hooks/use-tenant-device-settings";
import {
  LABEL_SIZE_OPTIONS,
  RECEIPT_PAPER_OPTIONS,
  receiptPaperOptionLabel,
  type LabelSize,
  type ReceiptPaper,
  type TenantDeviceSettings,
} from "@/utils/tenant-device-settings";

type Section = "scanner" | "printer" | "attendance";

export default function DeviceSettingsForm({
  tenantId,
  section,
  canSave = true,
  embedded = false,
}: {
  tenantId: string | null;
  section: Section;
  canSave?: boolean;
  embedded?: boolean;
}) {
  const loaded = useTenantDeviceSettings();
  const { toast } = useToast();
  const { alertError } = useAlert();
  const [draft, setDraft] = useState<TenantDeviceSettings>(loaded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(loaded);
  }, [loaded]);

  async function save() {
    if (!canSave) {
      void alertError("You do not have permission to change device settings.", {
        title: "Could not save device settings",
      });
      return;
    }
    if (!tenantId) {
      void alertError("Workspace session unavailable.", {
        title: "Could not save device settings",
      });
      return;
    }
    setBusy(true);
    const message = await saveTenantDeviceSettings(tenantId, draft);
    setBusy(false);
    if (message) {
      void alertError(message, { title: "Could not save device settings" });
      return;
    }
    toast("Device settings saved");
  }

  const body = (
    <>
      {embedded ? null : (
        <h3 className="text-base font-semibold text-[#0f2744]">Device settings</h3>
      )}
      {section === "scanner" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Minimum barcode length
            </span>
            <input
              type="number"
              min={1}
              max={64}
              className={inputClassName}
              value={draft.scanner_min_length}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scanner_min_length: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Maximum gap between keys (ms)
            </span>
            <input
              type="number"
              min={10}
              max={2000}
              className={inputClassName}
              value={draft.scanner_max_gap_ms}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scanner_max_gap_ms: Number(event.target.value),
                }))
              }
            />
          </label>
        </div>
      ) : null}
      {section === "printer" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Receipt paper
            </span>
            <select
              className={inputClassName}
              value={draft.receipt_paper}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  receipt_paper: event.target.value as ReceiptPaper,
                }))
              }
            >
              {RECEIPT_PAPER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {receiptPaperOptionLabel(option)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">
              For auto-cut, set the printer driver paper to the roll size (e.g. 80 x Receipt / 80mm x 297mm roll) and enable &apos;Cut at end of document&apos;.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Label size</span>
            <select
              className={inputClassName}
              value={draft.label_size}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  label_size: event.target.value as LabelSize,
                }))
              }
            >
              {LABEL_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "a4_sheet" ? "A4 sheet" : `${option} mm`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {section === "attendance" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Offline after (minutes)
            </span>
            <input
              type="number"
              min={1}
              className={inputClassName}
              value={draft.offline_alert_minutes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  offline_alert_minutes: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Working hours start
            </span>
            <TimePickerField
              aria-label="Working hours start"
              value={draft.working_hours_start}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  working_hours_start: value,
                }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Working hours end
            </span>
            <TimePickerField
              aria-label="Working hours end"
              value={draft.working_hours_end}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  working_hours_end: value,
                }))
              }
            />
          </label>
        </div>
      ) : null}
      {canSave ? (
        <DashboardButton
          type="button"
          className="mt-4"
          disabled={busy}
          onClick={() => void save()}
        >
          Save settings
        </DashboardButton>
      ) : null}
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      {body}
    </section>
  );
}
