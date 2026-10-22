"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";
import type { DirectorScorecardSettingsMeta } from "@/lib/finance/director-scorecard-settings";

type DirectorScorecardSettingsDialogProps = {
  open: boolean;
  initialSettings: DirectorScorecardSettingsMeta;
  onClose: () => void;
  onSaved: (settings: DirectorScorecardSettingsMeta) => void;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function toFormState(meta: DirectorScorecardSettingsMeta) {
  return {
    cit_rate_pct: String(meta.citRatePct),
    gsl_rate_pct: String(meta.gslRatePct),
    dividend_wht_rate_pct: String(meta.dividendWhtRatePct),
    reserve_pct: String(meta.reservePct),
    reinvest_pct: String(meta.reinvestPct),
    owners_pct: String(meta.ownersPct),
  };
}

export default function DirectorScorecardSettingsDialog({
  open,
  initialSettings,
  onClose,
  onSaved,
}: DirectorScorecardSettingsDialogProps) {
  const titleId = useId();
  const formId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const splitGateRef = useRef<HTMLInputElement>(null);
  const { alertError } = useAlert();
  const { toast } = useToast();

  const [form, setForm] = useState(() => toFormState(initialSettings));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toFormState(initialSettings));
    }
  }, [open, initialSettings]);

  const splitTotal = useMemo(() => {
    const reserve = Number(form.reserve_pct) || 0;
    const reinvest = Number(form.reinvest_pct) || 0;
    const owners = Number(form.owners_pct) || 0;
    return Math.round((reserve + reinvest + owners) * 100) / 100;
  }, [form.reserve_pct, form.reinvest_pct, form.owners_pct]);

  useFocusTrap(open, panelRef);
  useDialogKeyboard(open, {
    onPrimary: () => {
      saveRef.current?.click();
    },
    onDismiss: onClose,
    primaryButtonRef: saveRef,
  });

  function syncSplitValidity(formElement: HTMLFormElement): boolean {
    splitGateRef.current?.setCustomValidity("");
    if (Math.abs(splitTotal - 100) > 0.001) {
      splitGateRef.current?.setCustomValidity(
        "Reserve, Reinvest, and Owners must total 100%.",
      );
    }
    if (!formElement.reportValidity()) {
      splitGateRef.current?.focus();
      splitGateRef.current?.reportValidity();
      return false;
    }
    return true;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!syncSplitValidity(formElement)) {
      return;
    }

    setSaving(true);
    try {
      const payload = {
        cit_rate_pct: Number(form.cit_rate_pct),
        gsl_rate_pct: Number(form.gsl_rate_pct),
        dividend_wht_rate_pct: Number(form.dividend_wht_rate_pct),
        reserve_pct: Number(form.reserve_pct),
        reinvest_pct: Number(form.reinvest_pct),
        owners_pct: Number(form.owners_pct),
      };

      const response = await fetch("/api/scorecard-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as
        | { settings?: DirectorScorecardSettingsMeta; error?: string }
        | null;

      if (!response.ok || !body?.settings) {
        void alertError(body?.error ?? "Unable to save scorecard settings.", {
          title: "Could not save settings",
        });
        return;
      }

      toast("Scorecard settings saved.");
      onSaved(body.settings);
      onClose();
    } catch {
      void alertError("Unable to save scorecard settings. Check your connection.", {
        title: "Could not save settings",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-semibold text-[#0f2744]">
          Scorecard settings
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          These rates apply to every month shown on the scorecard. Planning
          figures, not tax advice.
        </p>

        <form id={formId} className="mt-4 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <input
            ref={splitGateRef}
            type="text"
            tabIndex={-1}
            aria-hidden="true"
            readOnly
            value={Math.abs(splitTotal - 100) < 0.001 ? "ok" : ""}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="cit_rate_pct" className="mb-1 block text-sm font-medium text-slate-700">
                CIT rate %
              </label>
              <input
                id="cit_rate_pct"
                name="cit_rate_pct"
                type="number"
                required
                min={0}
                max={100}
                step={0.01}
                value={form.cit_rate_pct}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    cit_rate_pct: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label htmlFor="gsl_rate_pct" className="mb-1 block text-sm font-medium text-slate-700">
                GSL rate %
              </label>
              <input
                id="gsl_rate_pct"
                name="gsl_rate_pct"
                type="number"
                required
                min={0}
                max={100}
                step={0.01}
                value={form.gsl_rate_pct}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    gsl_rate_pct: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label
                htmlFor="dividend_wht_rate_pct"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Dividend WHT rate %
              </label>
              <input
                id="dividend_wht_rate_pct"
                name="dividend_wht_rate_pct"
                type="number"
                required
                min={0}
                max={100}
                step={0.01}
                value={form.dividend_wht_rate_pct}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dividend_wht_rate_pct: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Profit split</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="reserve_pct" className="mb-1 block text-xs font-medium text-slate-600">
                  Reserve %
                </label>
                <input
                  id="reserve_pct"
                  name="reserve_pct"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.reserve_pct}
                  onChange={(event) => {
                    splitGateRef.current?.setCustomValidity("");
                    setForm((current) => ({
                      ...current,
                      reserve_pct: event.target.value,
                    }));
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="reinvest_pct" className="mb-1 block text-xs font-medium text-slate-600">
                  Reinvest %
                </label>
                <input
                  id="reinvest_pct"
                  name="reinvest_pct"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.reinvest_pct}
                  onChange={(event) => {
                    splitGateRef.current?.setCustomValidity("");
                    setForm((current) => ({
                      ...current,
                      reinvest_pct: event.target.value,
                    }));
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="owners_pct" className="mb-1 block text-xs font-medium text-slate-600">
                  Owners %
                </label>
                <input
                  id="owners_pct"
                  name="owners_pct"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.owners_pct}
                  onChange={(event) => {
                    splitGateRef.current?.setCustomValidity("");
                    setForm((current) => ({
                      ...current,
                      owners_pct: event.target.value,
                    }));
                  }}
                  className={inputClassName}
                />
              </div>
            </div>
            <p
              className={`mt-2 text-sm tabular-nums ${
                Math.abs(splitTotal - 100) < 0.001
                  ? "text-emerald-800"
                  : "text-amber-900"
              }`}
            >
              Total: {splitTotal}%
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              ref={saveRef}
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
