"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  formatProductSalesTaxRateReviewLabel,
  isGraTinConfigured,
  normalizeTaxSettings,
} from "./tax-utils";
import {
  TAX_SETTINGS_ON_CONFLICT,
  scopeTaxSettingsRead,
} from "@/utils/phase5e-key-structure";
import { useStampBusinessUnitId, useBusinessUnitReadScope, useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope, REMIT_REQUIRES_SCOPED_BU_MESSAGE } from "@/utils/business-unit-view";
import {
  TAX_LEDGER_SELECT,
  GRA_TAX_COMPONENTS,
  PAYE_COMPONENTS,
  REMINDER_WINDOW_DAYS,
  SSNIT_COMPONENTS,
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
  type TaxBalanceSummary,
  type TaxLedgerComponent,
  type TaxLedgerEntry,
  type TaxLedgerFilters,
} from "./tax-ledger-utils";
import {
  computeStatutoryDueDate,
  listStatutoryPeriodObligations,
  pickDueRuleFromSettings,
  type StatutoryDueRuleKind,
} from "./statutory-due-rules";
import { summarizeGraReconciliationLedger } from "./gra-reconciliation-ledger";
import { StatutoryObligationList } from "./statutory-obligation-list";
import {
  StatutoryDueRuleFields,
  dueRuleFormToRule,
  settingsToDueRuleForm,
  type DueRuleFormValue,
} from "./statutory-due-rule-fields";
import { StatutoryGraReconciliationPanel } from "./statutory-gra-reconciliation-panel";
import {
  REMIT_TAX_KIND_LABEL,
  buildRemitExpenseReceiptNo,
  computeRemitCashAmount,
  filterOpenEntriesForRemit,
  remitKindFromReceiptNo,
  type RemitTaxKind,
} from "./tax-ledger-remit";
import { isPaidStatus } from "./accrued-wages-utils";
import ProductSalesTaxRateSettings from "./product-sales-tax-rate-settings";
import ProductSaleNotificationThresholdSettings from "./product-sale-notification-threshold-settings";
import TaxSettingReviewBanner from "./tax-setting-review-banner";
import {
  fetchLinkedGraPenaltyExpenseForPeriod,
  type LinkedGraPenaltyExpense,
} from "./gra-penalty-expense-utils";
import type { GraReconciliationKind } from "./statutory-due-rules";
import { UndoRemitPenaltyNoticeDialog } from "./undo-remit-penalty-notice-dialog";

type TaxLedgerProps = {
  tenantId: string;
  initialSettings: TaxSettings;
  initialEntries: TaxLedgerEntry[];
  fetchError: string | null;
  /** Create-only stamp for remittance expenses; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

type LedgerTab = "overview" | "gra" | "paye" | "ssnit" | "settings";

type SettingsForm = {
  vat_registered: boolean;
  gra_tin: string;
  default_vat_bundle_rate: string;
  default_wht_rate: string;
  vat_return_period: VatReturnPeriod;
  vatDue: DueRuleFormValue;
  whtDue: DueRuleFormValue;
  payeDue: DueRuleFormValue;
  ssnitDue: DueRuleFormValue;
  tier2Due: DueRuleFormValue;
  reminder_enabled: boolean;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

const undoButtonClassName =
  "rounded-md border border-amber-700 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50";

const ALL_REMIT_KINDS: RemitTaxKind[] = ["ssnit", "paye", "vat", "wht"];

type PaidRemitUi = {
  amount: number;
  receiptNo: string;
};

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
    default_wht_rate: String(settings.default_wht_rate),
    vat_return_period: settings.vat_return_period,
    vatDue: settingsToDueRuleForm({
      monthsAfter: settings.vat_due_months_after_period,
      dayRule: settings.vat_due_day_rule,
      dayNumber: settings.vat_due_day_number,
    }),
    whtDue: settingsToDueRuleForm({
      monthsAfter: settings.wht_due_months_after_period,
      dayRule: settings.wht_due_day_rule,
      dayNumber: settings.wht_due_day_number,
    }),
    payeDue: settingsToDueRuleForm({
      monthsAfter: settings.paye_due_months_after_period,
      dayRule: settings.paye_due_day_rule,
      dayNumber: settings.paye_due_day_number,
    }),
    ssnitDue: settingsToDueRuleForm({
      monthsAfter: settings.ssnit_due_months_after_period,
      dayRule: settings.ssnit_due_day_rule,
      dayNumber: settings.ssnit_due_day_number,
    }),
    tier2Due: settingsToDueRuleForm({
      monthsAfter: settings.tier2_due_months_after_period,
      dayRule: settings.tier2_due_day_rule,
      dayNumber: settings.tier2_due_day_number,
    }),
    reminder_enabled: settings.reminder_enabled,
  };
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

function filterObligationsForTab(
  obligations: ReturnType<typeof listStatutoryPeriodObligations>,
  kinds: StatutoryDueRuleKind[],
  periodMonth: string,
): ReturnType<typeof listStatutoryPeriodObligations> {
  const kindSet = new Set(kinds);
  return obligations.filter((row) => {
    if (!kindSet.has(row.kind)) {
      return false;
    }
    if (periodMonth && row.periodMonth !== periodMonth) {
      return false;
    }
    return true;
  });
}

function EntriesTable({
  entries,
  emptyMessage,
}: {
  entries: TaxLedgerEntry[];
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
          </tr>
        </thead>
        <tbody className={scrollableTableBodyClassName}>
          {entries.length === 0 ? (
            <tr>
              <td
                colSpan={8}
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
  activeBusinessUnitId = null,
}: TaxLedgerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const { viewAllBusinessUnits } = useBusinessUnitView();
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

  useEffect(() => {
    const periodMonth = searchParams.get("periodMonth")?.trim();
    if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) {
      return;
    }
    setFilters((current) =>
      current.periodMonth === periodMonth
        ? current
        : { ...current, periodMonth },
    );
  }, [searchParams]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [remittingKind, setRemittingKind] = useState<RemitTaxKind | null>(null);
  const [undoingKind, setUndoingKind] = useState<RemitTaxKind | null>(null);
  const [paidRemits, setPaidRemits] = useState<
    Partial<Record<RemitTaxKind, PaidRemitUi>>
  >({});
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [undoRemitPenaltyNotice, setUndoRemitPenaltyNotice] =
    useState<LinkedGraPenaltyExpense | null>(null);

  function remitKindToGraReconciliationKind(
    kind: RemitTaxKind,
  ): GraReconciliationKind | null {
    if (kind === "vat" || kind === "wht" || kind === "paye") {
      return kind;
    }
    return null;
  }

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

  /** Component-tab cards follow Period Month when set; otherwise all open periods. */
  const periodScopedSummary = useMemo(
    () =>
      summarizeOpenTaxBalances(
        scopedEntries,
        filters.periodMonth ? filters.periodMonth : null,
      ),
    [scopedEntries, filters.periodMonth],
  );

  const graReconciliationLedgerByKind = useMemo(() => {
    if (!filters.periodMonth) {
      return null;
    }
    const periodMonth = filters.periodMonth;
    return {
      vat: summarizeGraReconciliationLedger(
        entries,
        "vat",
        periodMonth,
        settings.vat_return_period,
      ),
      wht: summarizeGraReconciliationLedger(
        entries,
        "wht",
        periodMonth,
        settings.vat_return_period,
      ),
      paye: summarizeGraReconciliationLedger(
        entries,
        "paye",
        periodMonth,
        settings.vat_return_period,
      ),
    };
  }, [entries, filters.periodMonth, settings.vat_return_period]);

  const graReconciliationDueDateByKind = useMemo(() => {
    if (!filters.periodMonth) {
      return null;
    }
    const periodMonth = filters.periodMonth;
    return {
      vat: computeStatutoryDueDate(
        periodMonth,
        pickDueRuleFromSettings(settings, "vat"),
      ),
      wht: computeStatutoryDueDate(
        periodMonth,
        pickDueRuleFromSettings(settings, "wht"),
      ),
      paye: computeStatutoryDueDate(
        periodMonth,
        pickDueRuleFromSettings(settings, "paye"),
      ),
    };
  }, [filters.periodMonth, settings]);

  const periodScopeHint = filters.periodMonth
    ? `Selected period: ${formatPeriodMonthLabel(filters.periodMonth)}`
    : "All open periods (select Period Month to scope)";

  const statutoryObligations = useMemo(
    () =>
      listStatutoryPeriodObligations({
        entries,
        settings,
      }),
    [entries, settings],
  );

  const reminders = useMemo(
    () => getUpcomingTaxReminders(settings, entries),
    [entries, settings],
  );

  const overviewActionObligations = useMemo(
    () =>
      statutoryObligations.filter(
        (row) => row.isOverdue || row.daysUntil <= REMINDER_WINDOW_DAYS,
      ),
    [statutoryObligations],
  );

  const graTinMissing = !isGraTinConfigured(settings);

  function openRemitCandidates(kind: RemitTaxKind) {
    if (!filters.periodMonth) {
      return [];
    }
    return filterOpenEntriesForRemit(
      entries,
      kind,
      filters.periodMonth,
      tenantId,
    );
  }

  async function refreshEntries() {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase
        .from("tax_ledger_entries")
        .select(TAX_LEDGER_SELECT)
        .eq("tenant_id", tenantId),
      buReadScope,
    )
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

  async function refreshPaidRemits(periodMonth: string | null) {
    if (!periodMonth) {
      setPaidRemits({});
      return;
    }

    const receiptNos = ALL_REMIT_KINDS.map((kind) =>
      buildRemitExpenseReceiptNo(kind, periodMonth),
    );

    const { data, error: remittanceError } = await supabase
      .from("expense_register")
      .select("receipt_no, amount, payment_status")
      .eq("tenant_id", tenantId)
      .in("receipt_no", receiptNos);

    if (remittanceError) {
      setError(remittanceError.message);
      return;
    }

    const next: Partial<Record<RemitTaxKind, PaidRemitUi>> = {};
    for (const row of data ?? []) {
      if (!isPaidStatus(row.payment_status)) {
        continue;
      }
      const kind = remitKindFromReceiptNo(row.receipt_no as string | null);
      if (!kind) {
        continue;
      }
      next[kind] = {
        amount: Number(row.amount) || 0,
        receiptNo: (row.receipt_no as string) ?? "",
      };
    }
    setPaidRemits(next);
  }

  useEffect(() => {
    void refreshPaidRemits(filters.periodMonth || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when period or tenant changes
  }, [filters.periodMonth, tenantId]);

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

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setSavingSettings(false);
      return;
    }

    const vatRule = dueRuleFormToRule(form.vatDue);
    const whtRule = dueRuleFormToRule(form.whtDue);
    const payeRule = dueRuleFormToRule(form.payeDue);
    const ssnitRule = dueRuleFormToRule(form.ssnitDue);
    const tier2Rule = dueRuleFormToRule(form.tier2Due);

    for (const [label, rule] of [
      ["VAT", vatRule],
      ["WHT", whtRule],
      ["PAYE", payeRule],
      ["SSNIT Tier 1", ssnitRule],
      ["Tier 2", tier2Rule],
    ] as const) {
      if (
        rule.dayRule === "day" &&
        (rule.dayNumber == null || rule.dayNumber < 1 || rule.dayNumber > 31)
      ) {
        setError(`${label} due day must be between 1 and 31.`);
        setSavingSettings(false);
        return;
      }
    }

    const payload = {
      tenant_id: tenantId,
      business_unit_id: stampBusinessUnit.businessUnitId,
      vat_registered: form.vat_registered,
      gra_tin: form.gra_tin.trim() || null,
      default_vat_bundle_rate: Number(form.default_vat_bundle_rate) || 0,
      default_wht_rate: Number(form.default_wht_rate) || 0,
      vat_return_period: form.vat_return_period,
      vat_due_months_after_period: vatRule.monthsAfterPeriod,
      vat_due_day_rule: vatRule.dayRule,
      vat_due_day_number: vatRule.dayRule === "day" ? vatRule.dayNumber : null,
      wht_due_months_after_period: whtRule.monthsAfterPeriod,
      wht_due_day_rule: whtRule.dayRule,
      wht_due_day_number: whtRule.dayRule === "day" ? whtRule.dayNumber : null,
      paye_due_months_after_period: payeRule.monthsAfterPeriod,
      paye_due_day_rule: payeRule.dayRule,
      paye_due_day_number:
        payeRule.dayRule === "day" ? payeRule.dayNumber : null,
      ssnit_due_months_after_period: ssnitRule.monthsAfterPeriod,
      ssnit_due_day_rule: ssnitRule.dayRule,
      ssnit_due_day_number:
        ssnitRule.dayRule === "day" ? ssnitRule.dayNumber : null,
      tier2_due_months_after_period: tier2Rule.monthsAfterPeriod,
      tier2_due_day_rule: tier2Rule.dayRule,
      tier2_due_day_number:
        tier2Rule.dayRule === "day" ? tier2Rule.dayNumber : null,
      reminder_enabled: form.reminder_enabled,
      updated_at: new Date().toISOString(),
    };

    const { data, error: saveError } = await supabase
      .from("tax_settings")
      .upsert(payload, { onConflict: TAX_SETTINGS_ON_CONFLICT })
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

  async function handleRemitForPeriod(kind: RemitTaxKind) {
    if (!filters.periodMonth) {
      setError("Select a period month before remitting.");
      return;
    }

    if (viewAllBusinessUnits || buReadScope.mode === "all") {
      setError(REMIT_REQUIRES_SCOPED_BU_MESSAGE);
      return;
    }

    const candidates = openRemitCandidates(kind);
    const label = REMIT_TAX_KIND_LABEL[kind];
    const periodLabel = formatPeriodMonthLabel(filters.periodMonth);
    const cashPreview = computeRemitCashAmount(candidates, kind);

    if (candidates.length === 0) {
      setInfoMessage(`No open ${label} liabilities for ${periodLabel} to remit.`);
      return;
    }

    if (kind === "vat" && cashPreview <= 0) {
      setInfoMessage(
        `No net VAT payable for ${periodLabel} (output ≤ input). Nothing to remit.`,
      );
      return;
    }

    const confirmDetail =
      kind === "ssnit"
        ? `This posts one Cash Position outflow of ${formatGHS(cashPreview)} (employee + employer), clears ${candidates.length} SSNIT Tax Ledger leg(s), and settles any Accrued Employer SSNIT expense for the period without double-counting cash.`
        : `This posts one Cash Position outflow of ${formatGHS(cashPreview)} and clears ${candidates.length} open ${label} Tax Ledger leg(s) for the period.`;

    if (
      !window.confirm(
        `Remit ${label} for ${periodLabel}?\n\n${confirmDetail}`,
      )
    ) {
      return;
    }

    setRemittingKind(kind);
    setError(null);
    setInfoMessage(null);

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setRemittingKind(null);
      return;
    }

    const response = await fetch("/api/finance/tax-ledger/remit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodMonth: filters.periodMonth,
        kind,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string | null;
      dueDateAdvanced?: boolean;
      legsCleared?: number;
    };

    if (!response.ok || result.error) {
      setError(result.error ?? "Failed to remit tax for period.");
    } else if (result.message) {
      setInfoMessage(result.message);
    }

    if (result.dueDateAdvanced || (result.legsCleared ?? 0) > 0) {
      const { data: settingsRow } = await scopeTaxSettingsRead(
        supabase
          .from("tax_settings")
          .select(TAX_SETTINGS_FULL_SELECT)
          .eq("tenant_id", tenantId),
        activeBusinessUnitId ?? null,
      ).maybeSingle();
      if (settingsRow) {
        const normalized =
          normalizeTaxSettings(settingsRow as TaxSettings) ?? settings;
        setSettings(normalized);
        setForm(settingsToForm(normalized));
      }
    }

    await refreshEntries();
    await refreshPaidRemits(filters.periodMonth || null);
    setRemittingKind(null);
    router.refresh();
  }

  async function handleUndoRemitForPeriod(kind: RemitTaxKind) {
    if (!filters.periodMonth) {
      setError("Select a period month before undoing a remittance.");
      return;
    }

    if (viewAllBusinessUnits || buReadScope.mode === "all") {
      setError(REMIT_REQUIRES_SCOPED_BU_MESSAGE);
      return;
    }

    const paid = paidRemits[kind];
    const label = REMIT_TAX_KIND_LABEL[kind];
    const periodLabel = formatPeriodMonthLabel(filters.periodMonth);

    if (!paid) {
      setInfoMessage(
        `No Paid ${label} remittance for ${periodLabel} to undo.`,
      );
      return;
    }

    const confirmDetail =
      kind === "ssnit"
        ? `This deletes Cash Position outflow ${formatGHS(paid.amount)} (${paid.receiptNo}), reopens remitted SSNIT Tax Ledger legs for the period, and restores Employer SSNIT from Settled → Accrued only when Remit had set Settled. Mark-as-Paid Employer SSNIT cash is NOT reversed.`
        : `This deletes Cash Position outflow ${formatGHS(paid.amount)} (${paid.receiptNo}) and reopens remitted ${label} Tax Ledger legs for the period.`;

    let linkedPenalty: LinkedGraPenaltyExpense | null = null;
    const graKind = remitKindToGraReconciliationKind(kind);
    if (graKind && stampBusinessUnit.ok) {
      linkedPenalty = await fetchLinkedGraPenaltyExpenseForPeriod({
        supabase,
        tenantId,
        businessUnitId: stampBusinessUnit.businessUnitId,
        periodMonth: filters.periodMonth,
        kind: graKind,
      });
    }

    const penaltyConfirmLine = linkedPenalty
      ? linkedPenalty.expenses.length > 1
        ? `\n\nLinked penalty expenses totaling ${formatGHS(linkedPenalty.amount)} are linked to this period. Undoing the remittance does not remove them.`
        : `\n\nA penalty expense of ${formatGHS(linkedPenalty.amount)} (${linkedPenalty.date ? formatDate(linkedPenalty.date) : "unknown date"}) is linked to this period. Undoing the remittance does not remove it.`
      : "";

    if (
      !window.confirm(
        `Undo Remit ${label} for ${periodLabel}?\n\nWARNING: Undo assumes the real-world payment has NOT been sent to ${kind === "ssnit" ? "SSNIT" : "GRA"} yet.\n\n${confirmDetail}${penaltyConfirmLine}`,
      )
    ) {
      return;
    }

    setUndoingKind(kind);
    setError(null);
    setInfoMessage(null);

    const response = await fetch("/api/finance/tax-ledger/undo-remit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodMonth: filters.periodMonth,
        kind,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string | null;
    };

    if (!response.ok || result.error) {
      setError(result.error ?? "Failed to undo remittance.");
    } else {
      if (result.message) {
        setInfoMessage(result.message);
      }
      if (linkedPenalty) {
        setUndoRemitPenaltyNotice(linkedPenalty);
      }
    }

    await refreshEntries();
    await refreshPaidRemits(filters.periodMonth || null);
    setUndoingKind(null);
    router.refresh();
  }

  function RemitPeriodButtons({ kinds }: { kinds: RemitTaxKind[] }) {
    const busy = remittingKind !== null || undoingKind !== null;
    const remitBlockedForViewAll =
      viewAllBusinessUnits || buReadScope.mode === "all";

    return (
      <div className="flex flex-wrap items-center gap-2">
        {kinds.map((kind) => {
          const candidates = filters.periodMonth
            ? openRemitCandidates(kind)
            : [];
          const cashPreview = computeRemitCashAmount(candidates, kind);
          const paid = paidRemits[kind];
          const remitDisabled =
            busy ||
            remitBlockedForViewAll ||
            !filters.periodMonth ||
            candidates.length === 0 ||
            (kind === "vat" && cashPreview <= 0);
          const undoDisabled =
            busy ||
            remitBlockedForViewAll ||
            !filters.periodMonth ||
            !paid;
          const label = REMIT_TAX_KIND_LABEL[kind];

          return (
            <div key={kind} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={remitDisabled}
                onClick={() => handleRemitForPeriod(kind)}
                className={primaryButtonClassName}
                title={
                  !filters.periodMonth
                    ? "Select a period month filter to enable remit"
                    : candidates.length === 0
                      ? `No open ${label} liabilities in this period`
                      : `Posts cash and clears ${label} liabilities for the filtered period`
                }
              >
                {remittingKind === kind
                  ? `Remitting ${label}…`
                  : `Remit ${label} for period${
                      candidates.length > 0
                        ? ` (${candidates.length} · ${formatGHS(cashPreview)})`
                        : ""
                    }`}
              </button>
              {paid ? (
                <button
                  type="button"
                  disabled={undoDisabled}
                  onClick={() => handleUndoRemitForPeriod(kind)}
                  className={undoButtonClassName}
                  title={`Undo Remit ${label}: delete ${paid.receiptNo} and reopen remitted legs. Assumes payment was not sent.`}
                >
                  {undoingKind === kind
                    ? `Undoing ${label}…`
                    : `Undo Remit ${label} for period (${formatGHS(paid.amount)})`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderComponentTab(
    title: string,
    subtitle: string,
    balanceCards: React.ReactNode,
    obligationKinds: StatutoryDueRuleKind[],
    componentOptions: Array<{ value: string; label: string }>,
    directionOptions: Array<{ value: string; label: string }>,
    remitKinds: RemitTaxKind[],
    reconciliation?: React.ReactNode,
  ) {
    return (
      <div className="space-y-4">
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          periodOptions={periodOptions}
          componentOptions={componentOptions}
          directionOptions={directionOptions}
        />

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-[#0f2744]">{title}</h3>
          <p className="mb-1 text-sm text-slate-600">{subtitle}</p>
          <p className="mb-4 text-xs text-slate-500">{periodScopeHint}</p>
          {balanceCards}
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-semibold text-[#0f2744]">
              Due obligations
            </h4>
            <StatutoryObligationList
              obligations={filterObligationsForTab(
                statutoryObligations,
                obligationKinds,
                filters.periodMonth,
              )}
              kinds={obligationKinds}
              emptyMessage={
                filters.periodMonth
                  ? "No open obligations for this period and tax kind."
                  : "Select a period month to focus due obligations, or remit from open periods below."
              }
            />
          </div>
          {reconciliation}
        </section>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            {title} Entries
          </h3>
          <RemitPeriodButtons kinds={remitKinds} />
        </div>

        <EntriesTable
          entries={filteredEntries}
          emptyMessage={`No ${title.toLowerCase()} entries match the current filters.`}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Statutory remittance ledger for GRA tax (VAT/WHT), PAYE, and SSNIT —
        period balances, due-date reminders, Remit-for-period (cash +
        liability clear), and Undo Remit (reverse cash + reopen legs when
        payment has not been sent).
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
              <li
                key={`${reminder.kind}-${reminder.periodMonth ?? ""}-${reminder.dueDate}`}
              >
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
        <>
          {graTinMissing ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">Recommended setup: GRA TIN</p>
              <p className="mt-1">
                Add your Ghana Revenue Authority TIN in{" "}
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  className="font-medium text-[#0f2744] underline underline-offset-2 hover:text-[#18365c]"
                >
                  Statutory Settings
                </button>{" "}
                so tax records are complete. This is optional — invoices and
                statutory filings are not blocked if it is left blank.
              </p>
            </div>
          ) : null}

          <TaxSettingReviewBanner
            tenantId={tenantId}
            activeBusinessUnitId={activeBusinessUnitId}
            title="Review Product Sales Tax Rate"
            body="New workspaces default product sales and POS checkout tax treatment. Confirm or change it before processing product sales — this does not block sales."
            currentSettingLabel={formatProductSalesTaxRateReviewLabel(
              settings.product_sales_tax_rate,
            )}
            reviewedAt={settings.product_sales_tax_rate_reviewed_at}
            reviewField="product_sales_tax_rate_reviewed_at"
            onGoToSettings={() => setActiveTab("settings")}
            settingsLinkLabel="Open Statutory Settings"
          />

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

          {overviewActionObligations.length > 0 ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-[#0f2744]">
                Action required
              </h3>
              <StatutoryObligationList obligations={overviewActionObligations} />
            </section>
          ) : null}
        </>
      )}

      {activeTab === "gra" &&
        renderComponentTab(
          "GRA Tax",
          "VAT/NHIL/GETFund, VFRS, and WHT balances from the tax ledger.",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="Net VAT Position"
              value={periodScopedSummary.netVatPosition}
              hint="Output − Input"
            />
            <BalanceCard
              label="WHT Receivable"
              value={periodScopedSummary.whtReceivable}
            />
            <BalanceCard label="WHT Payable" value={periodScopedSummary.whtPayable} />
            <BalanceCard
              label="Output Tax (VAT Bundle)"
              value={periodScopedSummary.outputVatBundle}
            />
            <BalanceCard
              label="Output Tax (VFRS)"
              value={periodScopedSummary.outputVfrs}
            />
            <BalanceCard label="Input Tax" value={periodScopedSummary.inputTax} />
          </div>,
          ["vat", "wht"],
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
          ["vat", "wht"],
          stampBusinessUnit.ok ? (
            <StatutoryGraReconciliationPanel
              tenantId={tenantId}
              businessUnitId={stampBusinessUnit.businessUnitId}
              periodMonth={filters.periodMonth || null}
              vatReturnPeriod={settings.vat_return_period}
              rows={
                graReconciliationLedgerByKind && graReconciliationDueDateByKind
                  ? [
                      {
                        kind: "vat" as const,
                        label: "VAT (net)",
                        ledger: graReconciliationLedgerByKind.vat,
                        dueDateIso: graReconciliationDueDateByKind.vat,
                      },
                      {
                        kind: "wht" as const,
                        label: "WHT payable",
                        ledger: graReconciliationLedgerByKind.wht,
                        dueDateIso: graReconciliationDueDateByKind.wht,
                      },
                    ]
                  : []
              }
            />
          ) : null,
        )}

      {activeTab === "paye" &&
        renderComponentTab(
          "PAYE",
          "Payroll PAYE withholdings accrued at period lock (period aggregate).",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="PAYE Payable"
              value={periodScopedSummary.payePayable}
            />
          </div>,
          ["paye"],
          [{ value: "paye", label: "PAYE" }],
          [{ value: "statutory_payable", label: "Statutory Payable" }],
          ["paye"],
          stampBusinessUnit.ok ? (
            <StatutoryGraReconciliationPanel
              tenantId={tenantId}
              businessUnitId={stampBusinessUnit.businessUnitId}
              periodMonth={filters.periodMonth || null}
              vatReturnPeriod={settings.vat_return_period}
              rows={
                graReconciliationLedgerByKind && graReconciliationDueDateByKind
                  ? [
                      {
                        kind: "paye" as const,
                        label: "PAYE payable",
                        ledger: graReconciliationLedgerByKind.paye,
                        dueDateIso: graReconciliationDueDateByKind.paye,
                      },
                    ]
                  : []
              }
            />
          ) : null,
        )}

      {activeTab === "ssnit" &&
        renderComponentTab(
          "SSNIT",
          "Employee SSNIT, employer Tier 1, and Tier 2 remittance liabilities.",
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <BalanceCard
              label="SSNIT Employee"
              value={periodScopedSummary.ssnitEmployee}
            />
            <BalanceCard
              label="SSNIT Employer Tier 1"
              value={periodScopedSummary.ssnitEmployerTier1}
            />
            <BalanceCard label="Tier 2" value={periodScopedSummary.ssnitTier2} />
          </div>,
          ["ssnit", "tier2"],
          [
            { value: "ssnit_employee", label: "SSNIT Employee" },
            { value: "ssnit_employer_tier1", label: "SSNIT Employer Tier 1" },
            { value: "ssnit_tier2", label: "Tier 2" },
          ],
          [{ value: "statutory_payable", label: "Statutory Payable" }],
          ["ssnit"],
        )}

      {activeTab === "settings" && (
        <div className="space-y-6">
        <TaxSettingReviewBanner
          tenantId={tenantId}
          activeBusinessUnitId={activeBusinessUnitId}
          title="Review Product Sales Tax Rate"
          body="Confirm the default output tax rate for Product Sales and POS checkout, or change it below."
          currentSettingLabel={formatProductSalesTaxRateReviewLabel(
            settings.product_sales_tax_rate,
          )}
          reviewedAt={settings.product_sales_tax_rate_reviewed_at}
          reviewField="product_sales_tax_rate_reviewed_at"
        />

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
                  GRA TIN{" "}
                  {!isGraTinConfigured(settings) ? (
                    <span className="font-normal text-amber-700">
                      (recommended)
                    </span>
                  ) : null}
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
                {!isGraTinConfigured(settings) ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Optional. Used for tax filing records; leaving this blank
                    does not block invoices or statutory remittances.
                  </p>
                ) : null}
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

              <StatutoryDueRuleFields
                label="VAT due rule"
                value={form.vatDue}
                onChange={(value) => updateFormField("vatDue", value)}
              />
              <StatutoryDueRuleFields
                label="WHT due rule"
                value={form.whtDue}
                onChange={(value) => updateFormField("whtDue", value)}
              />
              <StatutoryDueRuleFields
                label="PAYE due rule"
                value={form.payeDue}
                onChange={(value) => updateFormField("payeDue", value)}
              />
              <StatutoryDueRuleFields
                label="SSNIT Tier 1 due rule"
                value={form.ssnitDue}
                onChange={(value) => updateFormField("ssnitDue", value)}
              />
              <StatutoryDueRuleFields
                label="Tier 2 due rule"
                value={form.tier2Due}
                onChange={(value) => updateFormField("tier2Due", value)}
              />

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

        <ProductSalesTaxRateSettings
          tenantId={tenantId}
          activeBusinessUnitId={activeBusinessUnitId}
          initialProductSalesTaxRate={settings.product_sales_tax_rate}
        />

        <ProductSaleNotificationThresholdSettings
          tenantId={tenantId}
          activeBusinessUnitId={activeBusinessUnitId}
          initialThreshold={settings.product_sale_notification_threshold}
        />
        </div>
      )}

      {undoRemitPenaltyNotice ? (
        <UndoRemitPenaltyNoticeDialog
          penalty={undoRemitPenaltyNotice}
          onClose={() => setUndoRemitPenaltyNotice(null)}
        />
      ) : null}
    </div>
  );
}
