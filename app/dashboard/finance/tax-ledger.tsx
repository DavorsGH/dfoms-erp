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
  GRA_TAX_COMPONENTS,
  PAYE_COMPONENTS,
  REMINDER_WINDOW_DAYS,
  REMITTED_STATUS,
  SSNIT_COMPONENTS,
  appendRemittedNote,
  buildRemittanceDueDatePatch,
  daysUntilDate,
  filterEntriesByComponents,
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
  todayIsoDate,
  type TaxBalanceSummary,
  type TaxLedgerComponent,
  type TaxLedgerEntry,
  type TaxLedgerFilters,
} from "./tax-ledger-utils";

type TaxLedgerProps = {
  tenantId: string;
  initialSettings: TaxSettings;
  initialEntries: TaxLedgerEntry[];
  fetchError: string | null;
};

type LedgerTab = "overview" | "gra" | "paye" | "ssnit" | "settings";

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
  paye_return_due_day: string;
  ssnit_return_due_day: string;
  tier2_return_due_day: string;
  next_paye_due_date: string;
  next_ssnit_due_date: string;
  next_tier2_due_date: string;
  reminder_enabled: boolean;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const TAB_ITEMS: Array<{ id: LedgerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "gra", label: "GRA Tax" },
  { id: "paye", label: "PAYE" },
  { id: "ssnit", label: "SSNIT" },
  { id: "settings", label: "Settings" },
];

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
    paye_return_due_day: String(settings.paye_return_due_day),
    ssnit_return_due_day: String(settings.ssnit_return_due_day),
    tier2_return_due_day: String(settings.tier2_return_due_day),
    next_paye_due_date: settings.next_paye_due_date ?? "",
    next_ssnit_due_date: settings.next_ssnit_due_date ?? "",
    next_tier2_due_date: settings.next_tier2_due_date ?? "",
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

function parseRequiredDay(value: string, label: string): number | null {
  const day = parseOptionalDay(value);
  if (day == null) {
    return null;
  }
  void label;
  return day;
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

function DueDateCard({
  label,
  dueDay,
  nextDue,
  onGoToSettings,
}: {
  label: string;
  dueDay: number | null;
  nextDue: string | null;
  onGoToSettings: () => void;
}) {
  const daysUntil = daysUntilDate(nextDue);

  let nextDueContent: React.ReactNode;
  if (!nextDue || daysUntil == null) {
    nextDueContent = (
      <span className="text-sm">
        <span className="text-slate-600">Next due: not set — </span>
        <button
          type="button"
          onClick={onGoToSettings}
          className="font-medium text-[#0f2744] underline underline-offset-2 hover:text-[#18365c]"
        >
          Set a due date in Settings
        </button>
      </span>
    );
  } else if (daysUntil < 0) {
    const overdue = Math.abs(daysUntil);
    nextDueContent = (
      <span className="text-sm font-medium text-red-600">
        Next due: {formatDate(nextDue)} — {overdue} day
        {overdue === 1 ? "" : "s"} overdue
      </span>
    );
  } else if (daysUntil === 0) {
    nextDueContent = (
      <span className="text-sm font-medium text-amber-700">
        Next due: {formatDate(nextDue)} — due today
      </span>
    );
  } else if (daysUntil <= REMINDER_WINDOW_DAYS) {
    nextDueContent = (
      <span className="text-sm font-medium text-amber-700">
        Next due: {formatDate(nextDue)} — due in {daysUntil} day
        {daysUntil === 1 ? "" : "s"}
      </span>
    );
  } else {
    nextDueContent = (
      <span className="text-sm text-slate-600">
        Next due: {formatDate(nextDue)}
      </span>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-1 text-sm text-slate-600">
        Due day: {dueDay == null ? "—" : dayOfMonthLabel(dueDay)}
      </p>
      <p>{nextDueContent}</p>
    </div>
  );
}

function dayOfMonthLabel(day: number): string {
  return `${day}`;
}

function EntriesTable({
  entries,
  remittingId,
  remittingPeriod,
  onRemitEntry,
  emptyMessage,
}: {
  entries: TaxLedgerEntry[];
  remittingId: string | null;
  remittingPeriod: boolean;
  onRemitEntry: (entry: TaxLedgerEntry) => void;
  emptyMessage: string;
}) {
  return (
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
          {entries.length === 0 ? (
            <tr>
              <td
                colSpan={9}
                className="px-4 py-6 text-center text-sm text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            entries.map((entry, index) => {
              const href = getSourceHref(entry.source_type, entry.source_id);
              const sourceLabel = formatSourceReference(entry);

              return (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatDate(entry.entry_date)}</td>
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
                  <td className="px-4 py-3">{formatGHS(entry.taxable_base)}</td>
                  <td className="px-4 py-3">
                    {entry.rate_pct == null ? "—" : `${entry.rate_pct}%`}
                  </td>
                  <td className="px-4 py-3">{formatGHS(entry.tax_amount)}</td>
                  <td className="px-4 py-3">{getStatusLabel(entry.status)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {entry.status === "open" ? (
                      <button
                        type="button"
                        disabled={remittingId === entry.id || remittingPeriod}
                        onClick={() => onRemitEntry(entry)}
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
  );
}

function FilterBar({
  filters,
  setFilters,
  periodOptions,
  componentOptions,
  directionOptions,
}: {
  filters: TaxLedgerFilters;
  setFilters: React.Dispatch<React.SetStateAction<TaxLedgerFilters>>;
  periodOptions: string[];
  componentOptions: Array<{ value: string; label: string }>;
  directionOptions: Array<{ value: string; label: string }>;
}) {
  return (
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
          {componentOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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
          {directionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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
  );
}

function OverviewCards({ summary }: { summary: TaxBalanceSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <BalanceCard
        label="Net VAT"
        value={summary.netVatPosition}
        hint="Output − Input"
      />
      <BalanceCard label="WHT Receivable" value={summary.whtReceivable} />
      <BalanceCard label="WHT Payable" value={summary.whtPayable} />
      <BalanceCard label="PAYE Payable" value={summary.payePayable} />
      <BalanceCard label="SSNIT Employee" value={summary.ssnitEmployee} />
      <BalanceCard
        label="SSNIT Employer Tier 1"
        value={summary.ssnitEmployerTier1}
      />
      <BalanceCard label="Tier 2" value={summary.ssnitTier2} />
    </div>
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

  const [activeTab, setActiveTab] = useState<LedgerTab>("overview");
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

  const tabComponents = useMemo((): readonly TaxLedgerComponent[] | null => {
    if (activeTab === "gra") {
      return GRA_TAX_COMPONENTS;
    }
    if (activeTab === "paye") {
      return PAYE_COMPONENTS;
    }
    if (activeTab === "ssnit") {
      return SSNIT_COMPONENTS;
    }
    return null;
  }, [activeTab]);

  const scopedEntries = useMemo(() => {
    if (!tabComponents) {
      return entries;
    }
    return filterEntriesByComponents(entries, tabComponents);
  }, [entries, tabComponents]);

  const periodOptions = useMemo(
    () => listPeriodMonths(scopedEntries),
    [scopedEntries],
  );

  const filteredEntries = useMemo(
    () => filterTaxLedgerEntries(scopedEntries, filters),
    [scopedEntries, filters],
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

    return scopedEntries.filter(
      (entry) =>
        entry.status === "open" &&
        entry.period_month.slice(0, 10) === filters.periodMonth &&
        (!filters.taxComponent || entry.tax_component === filters.taxComponent),
    );
  }, [scopedEntries, filters.periodMonth, filters.taxComponent]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .eq("tenant_id", tenantId)
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
    const payeDueDay = parseRequiredDay(form.paye_return_due_day, "PAYE");
    const ssnitDueDay = parseRequiredDay(form.ssnit_return_due_day, "SSNIT");
    const tier2DueDay = parseRequiredDay(form.tier2_return_due_day, "Tier 2");

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

    if (payeDueDay == null) {
      setError("PAYE Return Due Day must be between 1 and 31.");
      setSavingSettings(false);
      return;
    }

    if (ssnitDueDay == null) {
      setError("SSNIT Return Due Day must be between 1 and 31.");
      setSavingSettings(false);
      return;
    }

    if (tier2DueDay == null) {
      setError("Tier 2 Return Due Day must be between 1 and 31.");
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
      paye_return_due_day: payeDueDay,
      ssnit_return_due_day: ssnitDueDay,
      tier2_return_due_day: tier2DueDay,
      next_paye_due_date: form.next_paye_due_date || null,
      next_ssnit_due_date: form.next_ssnit_due_date || null,
      next_tier2_due_date: form.next_tier2_due_date || null,
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
    setInfoMessage("Statutory settings saved.");
    setSavingSettings(false);
    router.refresh();
  }

  async function markEntriesRemitted(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    const remittedOn = todayIsoDate();
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
            remitted_at: remittedOn,
            notes: appendRemittedNote(entry.notes),
            updated_at: nowIso,
          })
          .eq("id", entry.id)
          .eq("tenant_id", tenantId)
          .eq("status", "open"),
      ),
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }

    const remittedIds = new Set(updates.map((entry) => entry.id));
    const remainingOpen = entries.filter(
      (entry) => entry.status === "open" && !remittedIds.has(entry.id),
    );
    const dueDatePatch = buildRemittanceDueDatePatch(
      settings,
      updates.map((entry) => entry.tax_component),
      remainingOpen,
    );

    let dueAdvanceNote = "";
    if (Object.keys(dueDatePatch).length > 0) {
      const { data: advancedRow, error: advanceError } = await supabase
        .from("tax_settings")
        .update(dueDatePatch)
        .eq("tenant_id", tenantId)
        .select(TAX_SETTINGS_FULL_SELECT)
        .single();

      if (advanceError) {
        setError(
          `Entries remitted, but due-date advance failed: ${advanceError.message}`,
        );
      } else if (advancedRow) {
        const normalized =
          normalizeTaxSettings(advancedRow as TaxSettings) ?? settings;
        setSettings(normalized);
        setForm(settingsToForm(normalized));
        const advancedLabels = Object.keys(dueDatePatch)
          .map((field) => field.replace(/^next_/, "").replace(/_due_date$/, ""))
          .join(", ");
        dueAdvanceNote = ` Next due date advanced for ${advancedLabels}.`;
      }
    }

    setInfoMessage(
      updates.length === 1
        ? `Marked 1 entry as remitted (${stamp}).${dueAdvanceNote}`
        : `Marked ${updates.length} entries as remitted (${stamp}).${dueAdvanceNote}`,
    );
    await refreshEntries();
    router.refresh();
  }

  async function handleMarkEntryRemitted(entry: TaxLedgerEntry) {
    if (entry.status !== "open") {
      return;
    }

    const authority =
      entry.tax_component === "paye" ||
      entry.tax_component === "vat_bundle" ||
      entry.tax_component === "vfrs" ||
      entry.tax_component === "wht"
        ? "GRA"
        : "SSNIT";

    if (
      !window.confirm(
        `Mark this statutory ledger entry as remitted to ${authority}? This sets status to Paid.`,
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
    const scopeHint = filters.taxComponent
      ? ` (${getComponentLabel(filters.taxComponent as TaxLedgerComponent)})`
      : activeTab === "gra"
        ? " (GRA Tax components)"
        : activeTab === "paye"
          ? " (PAYE)"
          : activeTab === "ssnit"
            ? " (SSNIT components)"
            : "";

    if (
      !window.confirm(
        `Mark all ${openInFilterPeriod.length} open entr${openInFilterPeriod.length === 1 ? "y" : "ies"} for ${label}${scopeHint} as remitted? This sets status to Paid.`,
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

  function renderComponentTab(
    title: string,
    subtitle: string,
    balanceCards: React.ReactNode,
    dueCards: React.ReactNode,
    componentOptions: Array<{ value: string; label: string }>,
    directionOptions: Array<{ value: string; label: string }>,
  ) {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-[#0f2744]">{title}</h3>
          <p className="mb-4 text-sm text-slate-600">{subtitle}</p>
          {balanceCards}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {dueCards}
          </div>
        </section>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            {title} Entries
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
                ? "Remits only open entries in this tab’s component scope"
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

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          periodOptions={periodOptions}
          componentOptions={componentOptions}
          directionOptions={directionOptions}
        />

        <EntriesTable
          entries={filteredEntries}
          remittingId={remittingId}
          remittingPeriod={remittingPeriod}
          onRemitEntry={handleMarkEntryRemitted}
          emptyMessage={`No ${title.toLowerCase()} entries match the current filters.`}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Statutory remittance ledger for GRA tax (VAT/WHT), PAYE, and SSNIT —
        period balances, due-date reminders, and component-scoped remit.
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
          <p className="font-medium">Upcoming statutory filings</p>
          <ul className="list-disc space-y-1 pl-5">
            {reminders.map((reminder) => (
              <li key={`${reminder.kind}-${reminder.dueDate}`}>
                {formatReminderMessage(reminder)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-1">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setFilters({
                periodMonth: "",
                taxComponent: "",
                direction: "",
                status: "open",
              });
            }}
            className={`shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-[#0f2744] text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-[#0f2744]">
            Open Balances — All Time
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            Open statutory ledger entries across every period (current month
            bucket: {formatPeriodMonthLabel(currentPeriodMonth)}).
          </p>
          <OverviewCards summary={allTimeSummary} />
        </section>
      )}

      {activeTab === "gra" &&
        renderComponentTab(
          "GRA Tax",
          "VAT/NHIL/GETFund, VFRS, and WHT balances from the tax ledger.",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="Net VAT Position"
              value={allTimeSummary.netVatPosition}
              hint="Output − Input"
            />
            <BalanceCard
              label="WHT Receivable"
              value={allTimeSummary.whtReceivable}
            />
            <BalanceCard label="WHT Payable" value={allTimeSummary.whtPayable} />
            <BalanceCard
              label="Output Tax (VAT Bundle)"
              value={allTimeSummary.outputVatBundle}
            />
            <BalanceCard
              label="Output Tax (VFRS)"
              value={allTimeSummary.outputVfrs}
            />
            <BalanceCard label="Input Tax" value={allTimeSummary.inputTax} />
          </div>,
          <>
            <DueDateCard
              label="VAT"
              dueDay={settings.vat_return_due_day}
              nextDue={settings.next_vat_due_date}
              onGoToSettings={() => setActiveTab("settings")}
            />
            <DueDateCard
              label="WHT"
              dueDay={settings.wht_return_due_day}
              nextDue={settings.next_wht_due_date}
              onGoToSettings={() => setActiveTab("settings")}
            />
          </>,
          [
            { value: "vat_bundle", label: "VAT/NHIL/GETFund" },
            { value: "vfrs", label: "VFRS" },
            { value: "wht", label: "WHT" },
          ],
          [
            { value: "output", label: "Output" },
            { value: "input", label: "Input" },
            { value: "wht_receivable", label: "WHT Receivable" },
            { value: "wht_payable", label: "WHT Payable" },
            { value: "settlement", label: "Settlement" },
          ],
        )}

      {activeTab === "paye" &&
        renderComponentTab(
          "PAYE",
          "Payroll PAYE withholdings accrued at period lock (period aggregate).",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="PAYE Payable"
              value={allTimeSummary.payePayable}
            />
          </div>,
          <DueDateCard
            label="PAYE"
            dueDay={settings.paye_return_due_day}
            nextDue={settings.next_paye_due_date}
            onGoToSettings={() => setActiveTab("settings")}
          />,
          [{ value: "paye", label: "PAYE" }],
          [{ value: "statutory_payable", label: "Statutory Payable" }],
        )}

      {activeTab === "ssnit" &&
        renderComponentTab(
          "SSNIT",
          "Employee SSNIT, employer Tier 1, and Tier 2 remittance liabilities.",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="SSNIT Employee"
              value={allTimeSummary.ssnitEmployee}
            />
            <BalanceCard
              label="SSNIT Employer Tier 1"
              value={allTimeSummary.ssnitEmployerTier1}
            />
            <BalanceCard label="Tier 2" value={allTimeSummary.ssnitTier2} />
          </div>,
          <>
            <DueDateCard
              label="SSNIT Tier 1"
              dueDay={settings.ssnit_return_due_day}
              nextDue={settings.next_ssnit_due_date}
              onGoToSettings={() => setActiveTab("settings")}
            />
            <DueDateCard
              label="Tier 2"
              dueDay={settings.tier2_return_due_day}
              nextDue={settings.next_tier2_due_date}
              onGoToSettings={() => setActiveTab("settings")}
            />
          </>,
          [
            { value: "ssnit_employee", label: "SSNIT Employee" },
            { value: "ssnit_employer_tier1", label: "SSNIT Employer Tier 1" },
            { value: "ssnit_tier2", label: "Tier 2" },
          ],
          [{ value: "statutory_payable", label: "Statutory Payable" }],
        )}

      {activeTab === "settings" && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Statutory Settings
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
                    updateFormField(
                      "default_vat_bundle_rate",
                      event.target.value,
                    )
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
                  PAYE Return Due Day
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={form.paye_return_due_day}
                  onChange={(event) =>
                    updateFormField("paye_return_due_day", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  SSNIT Return Due Day
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={form.ssnit_return_due_day}
                  onChange={(event) =>
                    updateFormField("ssnit_return_due_day", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Tier 2 Return Due Day
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={form.tier2_return_due_day}
                  onChange={(event) =>
                    updateFormField("tier2_return_due_day", event.target.value)
                  }
                  className={inputClassName}
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

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Next PAYE Due Date
                </label>
                <input
                  type="date"
                  value={form.next_paye_due_date}
                  onChange={(event) =>
                    updateFormField("next_paye_due_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Next SSNIT Due Date
                </label>
                <input
                  type="date"
                  value={form.next_ssnit_due_date}
                  onChange={(event) =>
                    updateFormField("next_ssnit_due_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Next Tier 2 Due Date
                </label>
                <input
                  type="date"
                  value={form.next_tier2_due_date}
                  onChange={(event) =>
                    updateFormField("next_tier2_due_date", event.target.value)
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
              {savingSettings ? "Saving…" : "Save Statutory Settings"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
