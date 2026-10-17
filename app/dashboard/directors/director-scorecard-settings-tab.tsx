"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import type { DirectorScorecardSettingsMeta } from "@/lib/finance/director-scorecard-settings";
import {
  defaultDirectorScorecardSettingsMeta,
  formatScorecardRatesFooter,
} from "@/lib/finance/director-scorecard-settings";

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

type DirectorScorecardSettingsTabProps = {
  initialSettings: DirectorScorecardSettingsMeta | null;
};

export default function DirectorScorecardSettingsTab({
  initialSettings,
}: DirectorScorecardSettingsTabProps) {
  const formId = useId();
  const splitGateRef = useRef<HTMLInputElement>(null);
  const { alertError } = useAlert();
  const { toast } = useToast();

  const [settingsMeta, setSettingsMeta] = useState(
    initialSettings ?? defaultDirectorScorecardSettingsMeta(),
  );
  const [form, setForm] = useState(() => toFormState(settingsMeta));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialSettings) {
      setSettingsMeta(initialSettings);
      setForm(toFormState(initialSettings));
    }
  }, [initialSettings]);

  const splitTotal = useMemo(() => {
    const reserve = Number(form.reserve_pct) || 0;
    const reinvest = Number(form.reinvest_pct) || 0;
    const owners = Number(form.owners_pct) || 0;
    return Math.round((reserve + reinvest + owners) * 100) / 100;
  }, [form.reserve_pct, form.reinvest_pct, form.owners_pct]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    splitGateRef.current?.setCustomValidity("");
    if (Math.abs(splitTotal - 100) > 0.001) {
      splitGateRef.current?.setCustomValidity(
        "Reserve, Reinvest, and Owners must total 100%.",
      );
    }
    if (!formElement.reportValidity()) {
      splitGateRef.current?.focus();
      splitGateRef.current?.reportValidity();
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
          title: "Could not complete action",
        });
        return;
      }

      toast("Scorecard settings saved.");
      setSettingsMeta(body.settings);
      setForm(toFormState(body.settings));
      window.dispatchEvent(new Event("dfoms:scorecard-settings-saved"));
    } catch {
      void alertError("Unable to save scorecard settings. Check your connection.", {
        title: "Could not complete action",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-[#0f2744]">Scorecard settings</h2>
      <p className="mt-2 text-sm text-slate-600">
        These rates apply to every month on the Directors scorecard. Planning figures,
        not tax advice.
      </p>

      <form id={formId} className="mt-6 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
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
          {(
            [
              ["cit_rate_pct", "CIT rate %"],
              ["gsl_rate_pct", "GSL rate %"],
              ["dividend_wht_rate_pct", "Dividend WHT rate %"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={key} className="mb-1 block text-sm font-medium text-slate-700">
                {label}
              </label>
              <input
                id={key}
                name={key}
                type="number"
                required
                min={0}
                max={100}
                step={0.01}
                value={form[key]}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.value }))
                }
                className={inputClassName}
              />
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Profit split</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["reserve_pct", "Reserve %"],
                ["reinvest_pct", "Reinvest %"],
                ["owners_pct", "Owners %"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={key} className="mb-1 block text-xs font-medium text-slate-600">
                  {label}
                </label>
                <input
                  id={key}
                  name={key}
                  type="number"
                  required
                  min={0}
                  max={100}
                  step={0.01}
                  value={form[key]}
                  onChange={(event) => {
                    splitGateRef.current?.setCustomValidity("");
                    setForm((current) => ({ ...current, [key]: event.target.value }));
                  }}
                  className={inputClassName}
                />
              </div>
            ))}
          </div>
          <p
            className={`mt-2 text-sm tabular-nums ${
              Math.abs(splitTotal - 100) < 0.001 ? "text-emerald-800" : "text-amber-900"
            }`}
          >
            Total: {splitTotal}%
          </p>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <p className="mt-6 text-xs text-slate-500">
        {formatScorecardRatesFooter(settingsMeta)} Planning figures, not tax advice.
      </p>
    </section>
  );
}
