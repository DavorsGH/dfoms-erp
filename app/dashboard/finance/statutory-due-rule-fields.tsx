"use client";

import {
  STATUTORY_DUE_RULE_PREVIEW_PERIOD,
  computeStatutoryDueDate,
  formatDueRulePreview,
  type StatutoryDayRule,
  type StatutoryDueRule,
} from "./statutory-due-rules";
import { formatDate, formatPeriodMonthLabel } from "./tax-ledger-utils";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export type DueRuleFormValue = {
  monthsAfterPeriod: "0" | "1";
  dayRule: StatutoryDayRule;
  dayNumber: string;
};

export function dueRuleFormToRule(value: DueRuleFormValue): StatutoryDueRule {
  const parsedDay =
    value.dayRule === "day" ? Number(value.dayNumber) || 1 : 1;
  return {
    monthsAfterPeriod: value.monthsAfterPeriod === "1" ? 1 : 0,
    dayRule: value.dayRule,
    dayNumber:
      value.dayRule === "day"
        ? Math.min(31, Math.max(1, Math.trunc(parsedDay)))
        : null,
  };
}

export function StatutoryDueRuleFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DueRuleFormValue;
  onChange: (next: DueRuleFormValue) => void;
}) {
  const rule = dueRuleFormToRule(value);
  const preview = formatDueRulePreview(
    STATUTORY_DUE_RULE_PREVIEW_PERIOD,
    rule,
    formatPeriodMonthLabel,
    formatDate,
  );

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 md:col-span-2 xl:col-span-3">
      <p className="mb-3 text-sm font-semibold text-slate-800">{label}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Due month
          </label>
          <select
            value={value.monthsAfterPeriod}
            onChange={(event) =>
              onChange({
                ...value,
                monthsAfterPeriod: event.target.value as "0" | "1",
              })
            }
            className={inputClassName}
          >
            <option value="0">Same month as period</option>
            <option value="1">Following month</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Due day rule
          </label>
          <select
            value={value.dayRule}
            onChange={(event) =>
              onChange({
                ...value,
                dayRule: event.target.value as StatutoryDayRule,
              })
            }
            className={inputClassName}
          >
            <option value="day">Day N</option>
            <option value="last_day">Last day of month</option>
            <option value="last_working_day">Last working day (Mon–Fri)</option>
          </select>
        </div>
        {value.dayRule === "day" ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Day (1–31)
            </label>
            <input
              type="number"
              min={1}
              max={31}
              required
              value={value.dayNumber}
              onChange={(event) =>
                onChange({ ...value, dayNumber: event.target.value })
              }
              className={inputClassName}
            />
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Preview: {preview}
      </p>
    </div>
  );
}

export function settingsToDueRuleForm(settings: {
  monthsAfter: 0 | 1;
  dayRule: StatutoryDayRule;
  dayNumber: number | null;
}): DueRuleFormValue {
  return {
    monthsAfterPeriod: settings.monthsAfter === 1 ? "1" : "0",
    dayRule: settings.dayRule,
    dayNumber:
      settings.dayNumber == null ? "" : String(settings.dayNumber),
  };
}

export function previewDueRule(value: DueRuleFormValue): string {
  return formatDueRulePreview(
    STATUTORY_DUE_RULE_PREVIEW_PERIOD,
    dueRuleFormToRule(value),
    formatPeriodMonthLabel,
    formatDate,
  );
}

export { computeStatutoryDueDate };
