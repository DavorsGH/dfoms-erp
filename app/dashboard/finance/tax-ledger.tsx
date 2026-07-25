"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { getStripedRowClassName } from "./register-row-actions";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { TaxSettings, VatReturnPeriod } from "./tax-utils";
import {
  TAX_SETTINGS_FULL_SELECT,
  emptyTaxSettings,
  normalizeTaxSettings,
} from "./tax-utils";
import {
  TAX_LEDGER_SELECT,
  REMITTED_STATUS,
  appendRemittedNote,
  filterTaxLedgerEntries,
  formatGHS,
  formatDate,
  formatPeriodMonthLabel,
  formatReminderMessage,
  formatSourceReference,
  getComponentLabel,
  getCurrentPeriodMonth,
  getDirectionLabel,
  getSourceHref,
  getStatusLabel,
  getUpcomingTaxReminders,
  listPeriodMonths,
  normalizeTaxLedgerEntry,
  summarizeOpenTaxBalances,
  type TaxBalanceSummary,
  type TaxLedgerEntry,
  type TaxLedgerFilters,
} from "./tax-ledger-utils";

type TaxLedgerProps = {
  tenantId: string;
  initialSettings: TaxSettings;
  initialEntries: TaxLedgerEntry[];
  fetchError: string | null;
};

type SettingsForm = {
  vat_registered: boolean;
  gra_tin: string;
  default_vat_bundle_rate: string;
  default_vfrs_rate: string;
  default_wht_rate: string;
  vat_return_period: VatReturnPeriod;
  vat_return_due_day: string;
  wht_return_due_day: string;
  next_vat_due_date: string;
  next_wht_due_date: string;
  reminder_enabled: boolean;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function settingsToForm(settings: TaxSettings): SettingsForm {
  return {
    vat_registered: settings.vat_registered,
    gra_tin: settings.gra_tin ?? "",
    default_vat_bundle_rate: String(settings.default_vat_bundle_rate),
    default_vfrs_rate: String(settings.default_vfrs_rate),
    default_wht_rate: String(settings.default_wht_rate),
    vat_return_period: settings.vat_return_period,
    vat_return_due_day:
      settings.vat_return_due_day == null
        ? ""
        : String(settings.vat_return_due_day),
    wht_return_due_day:
      settings.wht_return_due_day == null
        ? ""
        : String(settings.wht_return_due_day),
    next_vat_due_date: settings.next_vat_due_date ?? "",
    next_wht_due_date: settings.next_wht_due_date ?? "",
    reminder_enabled: settings.reminder_enabled,
  };
}

function parseOptionalDay(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const day = Number(value);
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }

  return Math.trunc(day);
}

function BalanceCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="text-lg font-semibold text-[#0f2744]">{formatGHS(value)}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function BalanceSummarySection({
  title,
  subtitle,
  summary,
}: {
  title: string;
  subtitle: string;
  summary: TaxBalanceSummary;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-[#0f2744]">{title}</h3>
      <p className="mb-4 text-sm text-slate-600">{subtitle}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <BalanceCard label="WHT Receivable" value={summary.whtReceivable} />
        <BalanceCard label="WHT Payable" value={summary.whtPayable} />
        <BalanceCard
          label="Output Tax (VAT Bundle)"
          value={summary.outputVatBundle}
          hint="Services VAT/NHIL/GETFund/COVID"
        />
        <BalanceCard
          label="Output Tax (VFRS)"
          value={summary.outputVfrs}
          hint="Goods VAT Flat Rate Scheme"
        />
        <BalanceCard label="Input Tax" value={summary.inputTax} />
        <BalanceCard
          label="Net VAT Position"
          value={summary.netVatPosition}
          hint="Output − Input"
        />
      </div>
    </section>
  );
}

export default function TaxLedger({
  tenantId,
  initialSettings,
  initialEntries,
  fetchError,
}: TaxLedgerProps) {
  const router = useRouter();
  const supabase = createClient();
  const currentPeriodMonth = getCurrentPeriodMonth();

  const [settings, setSettings] = useState(initialSettings);
  const [form, setForm] = useState(() => settingsToForm(initialSettings));
  const [entries, setEntries] = useState(initialEntries);
  const [filters, setFilters] = useState<TaxLedgerFilters>({
    periodMonth: "",
    taxComponent: "",
    direction: "",
    status: "open",
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [remittingId, setRemittingId] = useState<string | null>(null);
  const [remittingPeriod, setRemittingPeriod] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettings(initialSettings);
    setForm(settingsToForm(initialSettings));
  }, [initialSettings]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const periodOptions = useMemo(() => listPeriodMonths(entries), [entries]);

  const filteredEntries = useMemo(
    () => filterTaxLedgerEntries(entries, filters),
    [entries, filters],
  );

  const currentPeriodSummary = useMemo(
    () => summarizeOpenTaxBalances(entries, currentPeriodMonth),
    [entries, currentPeriodMonth],
  );

  const allTimeSummary = useMemo(
    () => summarizeOpenTaxBalances(entries),
    [entries],
  );

  const reminders = useMemo(
    () => getUpcomingTaxReminders(settings),
    [settings],
  );

  const openInFilterPeriod = useMemo(() => {
    if (!filters.periodMonth) {
      return [];
    }

    return entries.filter(
      (entry) =>
        entry.status === "open" &&
        entry.period_month.slice(0, 10) === filters.periodMonth,
    );
  }, [entries, filters.periodMonth]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as TaxLedgerEntry[] | null) ?? []).map(normalizeTaxLedgerEntry),
    );
    setError(null);
  }

  function updateFormField<K extends keyof SettingsForm>(
    key: K,
    value: SettingsForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSavingSettings(true);
    setError(null);
    setInfoMessage(null);

    const vatDueDay = parseOptionalDay(form.vat_return_due_day);
    const whtDueDay = parseOptionalDay(form.wht_return_due_day);

    if (form.vat_return_due_day.trim() && vatDueDay == null) {
      setError("VAT Return Due Day must be between 1 and 31.");
      setSavingSettings(false);
      return;
    }

    if (form.wht_return_due_day.trim() && whtDueDay == null) {
      setError("WHT Return Due Day must be between 1 and 31.");
      setSavingSettings(false);
      return;
    }

    const payload = {
      tenant_id: tenantId,
      vat_registered: form.vat_registered,
      gra_tin: form.gra_tin.trim() || null,
      default_vat_bundle_rate: Number(form.default_vat_bundle_rate) || 0,
      default_vfrs_rate: Number(form.default_vfrs_rate) || 0,
      default_wht_rate: Number(form.default_wht_rate) || 0,
      vat_return_period: form.vat_return_period,
      vat_return_due_day: vatDueDay,
      wht_return_due_day: whtDueDay,
      next_vat_due_date: form.next_vat_due_date || null,
      next_wht_due_date: form.next_wht_due_date || null,
      reminder_enabled: form.reminder_enabled,
      updated_at: new Date().toISOString(),
    };

    const { data, error: saveError } = await supabase
      .from("tax_settings")
      .upsert(payload, { onConflict: "tenant_id" })
      .select(TAX_SETTINGS_FULL_SELECT)
      .single();

    if (saveError) {
      setError(saveError.message);
      setSavingSettings(false);
      return;
    }

    const normalized =
      normalizeTaxSettings(data as TaxSettings) ??
      emptyTaxSettings(tenantId);
    setSettings(normalized);
    setForm(settingsToForm(normalized));
    setInfoMessage("Tax settings saved.");
    setSavingSettings(false);
    router.refresh();
  }

  async function markEntriesRemitted(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    const stamp = appendRemittedNote(null);
    const updates = entries.filter(
      (entry) => ids.includes(entry.id) && entry.status === "open",
    );

    if (updates.length === 0) {
      setInfoMessage("No open entries to mark as remitted.");
      return;
    }

    const nowIso = new Date().toISOString();
    const results = await Promise.all(
      updates.map((entry) =>
        supabase
          .from("tax_ledger_entries")
          .update({
            status: REMITTED_STATUS,
            notes: appendRemittedNote(entry.notes),
            updated_at: nowIso,
          })
          .eq("id", entry.id)
          .eq("status", "open"),
      ),
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }

    setInfoMessage(
      updates.length === 1
        ? `Marked 1 entry as remitted (${stamp}).`
        : `Marked ${updates.length} entries as remitted (${stamp}).`,
    );
    await refreshEntries();
    router.refresh();
  }

  async function handleMarkEntryRemitted(entry: TaxLedgerEntry) {
    if (entry.status !== "open") {
      return;
    }

    if (
      !window.confirm(
        "Mark this tax ledger entry as remitted to GRA? This sets status to Paid.",
      )
    ) {
      return;
    }

    setRemittingId(entry.id);
    setError(null);
    setInfoMessage(null);
    await markEntriesRemitted([entry.id]);
    setRemittingId(null);
  }

  async function handleMarkPeriodRemitted() {
    if (!filters.periodMonth || openInFilterPeriod.length === 0) {
      return;
    }

    const label = formatPeriodMonthLabel(filters.periodMonth);
    if (
      !window.confirm(
        `Mark all ${openInFilterPeriod.length} open entr${openInFilterPeriod.length === 1 ? "y" : "ies"} for ${label} as remitted to GRA? This sets status to Paid.`,
      )
    ) {
      return;
    }

    setRemittingPeriod(true);
    setError(null);
    setInfoMessage(null);
    await markEntriesRemitted(openInFilterPeriod.map((entry) => entry.id));
    setRemittingPeriod(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Running GRA tax balances from the tax ledger, plus tenant VAT/WHT
        settings and due-date reminders.
      </p>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {infoMessage && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {infoMessage}
        </p>
      )}

      {reminders.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Upcoming GRA filings</p>
          <ul className="list-disc space-y-1 pl-5">
            {reminders.map((reminder) => (
              <li key={`${reminder.kind}-${reminder.dueDate}`}>
                {formatReminderMessage(reminder)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Tax Settings
        </h3>
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="flex items-center gap-2 md:col-span-2 xl:col-span-3">
              <input
                id="vat-registered"
                type="checkbox"
                checked={form.vat_registered}
                onChange={(event) =>
                  updateFormField("vat_registered", event.target.checked)
                }
                className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              <label
                htmlFor="vat-registered"
                className="text-sm font-medium text-slate-700"
              >
                VAT Registered
              </label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                GRA TIN
              </label>
              <input
                type="text"
                value={form.gra_tin}
                onChange={(event) =>
                  updateFormField("gra_tin", event.target.value)
                }
                className={inputClassName}
                placeholder="GRA taxpayer identification number"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Default VAT Bundle Rate (%)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.default_vat_bundle_rate}
                onChange={(event) =>
                  updateFormField("default_vat_bundle_rate", event.target.value)
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Default VFRS Rate (%)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.default_vfrs_rate}
                onChange={(event) =>
                  updateFormField("default_vfrs_rate", event.target.value)
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Default WHT Rate (%)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.default_wht_rate}
                onChange={(event) =>
                  updateFormField("default_wht_rate", event.target.value)
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                VAT Return Period
              </label>
              <select
                value={form.vat_return_period}
                onChange={(event) =>
                  updateFormField(
                    "vat_return_period",
                    event.target.value as VatReturnPeriod,
                  )
                }
                className={inputClassName}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                VAT Return Due Day
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={form.vat_return_due_day}
                onChange={(event) =>
                  updateFormField("vat_return_due_day", event.target.value)
                }
                className={inputClassName}
                placeholder="1–31"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                WHT Return Due Day
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={form.wht_return_due_day}
                onChange={(event) =>
                  updateFormField("wht_return_due_day", event.target.value)
                }
                className={inputClassName}
                placeholder="1–31"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Next VAT Due Date
              </label>
              <input
                type="date"
                value={form.next_vat_due_date}
                onChange={(event) =>
                  updateFormField("next_vat_due_date", event.target.value)
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Next WHT Due Date
              </label>
              <input
                type="date"
                value={form.next_wht_due_date}
                onChange={(event) =>
                  updateFormField("next_wht_due_date", event.target.value)
                }
                className={inputClassName}
              />
            </div>

            <div className="flex items-center gap-2 md:col-span-2 xl:col-span-3">
              <input
                id="reminder-enabled"
                type="checkbox"
                checked={form.reminder_enabled}
                onChange={(event) =>
                  updateFormField("reminder_enabled", event.target.checked)
                }
                className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              <label
                htmlFor="reminder-enabled"
                className="text-sm font-medium text-slate-700"
              >
                Reminder Enabled
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className={primaryButtonClassName}
          >
            {savingSettings ? "Saving…" : "Save Tax Settings"}
          </button>
        </form>
      </section>

      <BalanceSummarySection
        title={`Open Balances — ${formatPeriodMonthLabel(currentPeriodMonth)}`}
        subtitle="Open tax_ledger_entries for the current GRA month bucket."
        summary={currentPeriodSummary}
      />

      <BalanceSummarySection
        title="Open Balances — All Time"
        subtitle="All open tax_ledger_entries across every period."
        summary={allTimeSummary}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Tax Ledger Entries
          </h3>
          <button
            type="button"
            disabled={
              remittingPeriod ||
              !filters.periodMonth ||
              openInFilterPeriod.length === 0
            }
            onClick={handleMarkPeriodRemitted}
            className={secondaryButtonClassName}
            title={
              filters.periodMonth
                ? undefined
                : "Select a period month filter to enable batch remit"
            }
          >
            {remittingPeriod
              ? "Marking…"
              : `Mark Period as Remitted${
                  openInFilterPeriod.length > 0
                    ? ` (${openInFilterPeriod.length})`
                    : ""
                }`}
          </button>
        </div>

        <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period Month
            </label>
            <select
              value={filters.periodMonth}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  periodMonth: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">All periods</option>
              {periodOptions.map((period) => (
                <option key={period} value={period}>
                  {formatPeriodMonthLabel(period)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Tax Component
            </label>
            <select
              value={filters.taxComponent}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  taxComponent: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">All components</option>
              <option value="vat_bundle">VAT/NHIL/GETFund</option>
              <option value="vfrs">VFRS</option>
              <option value="wht">WHT</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Direction
            </label>
            <select
              value={filters.direction}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  direction: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">All directions</option>
              <option value="output">Output</option>
              <option value="input">Input</option>
              <option value="wht_receivable">WHT Receivable</option>
              <option value="wht_payable">WHT Payable</option>
              <option value="settlement">Settlement</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="filed">Filed</option>
              <option value="paid">Paid / Remitted</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Component</th>
                <th className={scrollableTableThClassName}>Direction</th>
                <th className={scrollableTableThClassName}>Source</th>
                <th className={scrollableTableThClassName}>Taxable Base</th>
                <th className={scrollableTableThClassName}>Rate</th>
                <th className={scrollableTableThClassName}>Tax Amount</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    No tax ledger entries match the current filters.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry, index) => {
                  const href = getSourceHref(entry.source_type, entry.source_id);
                  const sourceLabel = formatSourceReference(entry);

                  return (
                    <tr
                      key={entry.id}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td className="px-4 py-3">
                        {getComponentLabel(entry.tax_component)}
                      </td>
                      <td className="px-4 py-3">
                        {getDirectionLabel(entry.direction)}
                      </td>
                      <td className="px-4 py-3">
                        {href ? (
                          <Link
                            href={href}
                            className="text-[#0f2744] underline-offset-2 hover:underline"
                          >
                            {sourceLabel}
                          </Link>
                        ) : (
                          sourceLabel
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.taxable_base)}
                      </td>
                      <td className="px-4 py-3">
                        {entry.rate_pct == null ? "—" : `${entry.rate_pct}%`}
                      </td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.tax_amount)}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusLabel(entry.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {entry.status === "open" ? (
                          <button
                            type="button"
                            disabled={remittingId === entry.id || remittingPeriod}
                            onClick={() => handleMarkEntryRemitted(entry)}
                            className={secondaryButtonClassName}
                          >
                            {remittingId === entry.id
                              ? "Marking…"
                              : "Mark as Remitted"}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
