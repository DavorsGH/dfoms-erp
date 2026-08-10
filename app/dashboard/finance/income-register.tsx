"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { ClientEntry } from "../operations/clients-utils";
import type { ServiceType } from "../service-types";
import {
  calculateIncomeOutstanding,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  getIncomeEntryOutstanding,
  SERVICE_INCOME_REGISTER_SELECT,
  normalizeIncomeRegisterEntry,
  type IncomeRegisterEntry,
} from "./income-register-utils";
import {
  computeOutputTax,
  computeWhtAmount,
  formatOutputTaxHint,
  resolveDefaultWhtRate,
  roundTaxAmount,
  roundTaxRate,
  selectTaxRateOptions,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "./tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncIncomeRegisterTaxLedger,
} from "./tax-ledger-sync";
import RegisterRowActions, {
  confirmDeleteEntry,
  toDateInputValue,
} from "./register-row-actions";
import {
  getRegisterRowClassName,
  isAutoPostedIncomeRegisterEntry,
} from "./register-auto-posted-utils";
import {
  RegisterColumnFilterHeader,
  RegisterFilteredTotal,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  type RegisterColumnFilterValue,
} from "./register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";

type IncomeRegisterProps = {
  initialEntries: IncomeRegisterEntry[];
  initialServiceTypes: ServiceType[];
  initialClients: ClientEntry[];
  taxSettings: TaxSettings | null;
  taxRateCatalog: TaxRateCatalogEntry[];
  fetchError: string | null;
};

type IncomeFormState = {
  date: string;
  invoice_no: string;
  client_id: string;
  customer_name: string;
  service_category: string;
  description: string;
  amount: string;
  amount_received: string;
  wht_rate: string;
  wht_amount: string;
  tax_inclusive: boolean;
  payment_status: string;
  due_date: string;
  notes: string;
};

type IncomeFormTextField = Exclude<keyof IncomeFormState, "tax_inclusive">;

const emptyForm: IncomeFormState = {
  date: "",
  invoice_no: "",
  client_id: "",
  customer_name: "",
  service_category: "",
  description: "",
  amount: "",
  amount_received: "",
  wht_rate: "0",
  wht_amount: "",
  tax_inclusive: true,
  payment_status: "",
  due_date: "",
  notes: "",
};

const PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"];

// Income Register rows are always services; product sales are captured in CRM.
const INCOME_REGISTER_ENTRY_TYPE = "service" as const;

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatRateValue(rate: number): string {
  return String(roundTaxRate(rate));
}

export default function IncomeRegister({
  initialEntries,
  initialServiceTypes,
  initialClients,
  taxSettings,
  taxRateCatalog,
  fetchError,
}: IncomeRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeIncomeRegisterEntry),
  );
  const [serviceCategoryFilter, setServiceCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [customerNameFilter, setCustomerNameFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [serviceTypes, setServiceTypes] = useState(initialServiceTypes);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Once the user types a WHT amount we stop overwriting it from Amount × rate.
  const [whtAmountEdited, setWhtAmountEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const defaultWhtRate = formatRateValue(resolveDefaultWhtRate(taxSettings));

  const whtRateOptions = useMemo(() => {
    const options = new Map<string, string>([["0", "No WHT (0%)"]]);

    for (const rate of selectTaxRateOptions(taxRateCatalog, "wht")) {
      options.set(formatRateValue(rate.rate_pct), rate.label);
    }

    for (const rate of [defaultWhtRate, form.wht_rate]) {
      if (rate && rate !== "0" && !options.has(rate)) {
        options.set(rate, `WHT ${rate}%`);
      }
    }

    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => Number(left.value) - Number(right.value));
  }, [taxRateCatalog, defaultWhtRate, form.wht_rate]);

  const serviceCategoryOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter((entry) =>
            columnValuePassesFilter(
              getIncomeCustomerDisplayName(entry, initialClients),
              customerNameFilter,
            ),
          )
          .map((entry) => entry.service_category),
      ),
    [entries, customerNameFilter, initialClients],
  );

  const customerNameOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter((entry) =>
            columnValuePassesFilter(
              entry.service_category,
              serviceCategoryFilter,
            ),
          )
          .map((entry) =>
            getIncomeCustomerDisplayName(entry, initialClients),
          ),
      ),
    [entries, serviceCategoryFilter, initialClients],
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          columnValuePassesFilter(
            entry.service_category,
            serviceCategoryFilter,
          ) &&
          columnValuePassesFilter(
            getIncomeCustomerDisplayName(entry, initialClients),
            customerNameFilter,
          ),
      ),
    [entries, serviceCategoryFilter, customerNameFilter, initialClients],
  );

  const visibleAmountTotal = useMemo(() => {
    let total = 0;
    for (const entry of visibleEntries) {
      total += Number(entry.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [visibleEntries]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadServiceTypes() {
      const { data, error: refreshError } = await client
        .from("service_types")
        .select("name")
        .order("name", { ascending: true });

      if (refreshError) {
        setError(refreshError.message);
        return;
      }

      setServiceTypes(data ?? []);
    }

    loadServiceTypes();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("income_register")
      .select(SERVICE_INCOME_REGISTER_SELECT)
      .or("entry_type.eq.service,entry_type.is.null")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as IncomeRegisterEntry[] | null) ?? []).map((entry) =>
        normalizeIncomeRegisterEntry(entry),
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm({ ...emptyForm, wht_rate: defaultWhtRate });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: IncomeRegisterEntry) {
    if (isAutoPostedIncomeRegisterEntry(entry)) {
      setError(
        "This is a system non-cash adjustment (payroll / forfeit). It cannot be edited in the Income Register — editing would re-apply VAT/WHT and AR.",
      );
      return;
    }
    setEditingId(entry.id);
    setWhtAmountEdited(false);
    setForm({
      date: toDateInputValue(entry.date),
      invoice_no: entry.invoice_no,
      client_id: entry.client_id ?? "",
      customer_name: entry.customer_name ?? "",
      service_category: entry.service_category ?? "",
      description: entry.description ?? "",
      amount: String(entry.amount),
      amount_received: String(entry.amount_received),
      wht_rate: formatRateValue(entry.wht_rate ?? 0),
      wht_amount: entry.wht_amount == null ? "" : String(entry.wht_amount),
      tax_inclusive: entry.tax_inclusive ?? true,
      payment_status: entry.payment_status,
      due_date: toDateInputValue(entry.due_date),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    const target = entries.find((entry) => entry.id === id);
    if (target && isAutoPostedIncomeRegisterEntry(target)) {
      setError(
        "System non-cash adjustments cannot be deleted from the Income Register. Reverse them via payroll unlock / the originating correction script.",
      );
      return;
    }
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("income_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    // The income row is gone, so its open tax ledger legs are dropped too.
    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      id,
    );

    if (ledgerError) {
      setError(
        `Entry deleted, but its tax ledger entries could not be removed: ${ledgerError}`,
      );
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (editingId) {
      const editing = entries.find((entry) => entry.id === editingId);
      if (editing?.is_system_adjustment) {
        setError(
          "System non-cash adjustments cannot be saved from the Income Register.",
        );
        setLoading(false);
        return;
      }
    }

    const amount = Number(form.amount) || 0;
    const amountReceived = Number(form.amount_received) || 0;
    const whtRate = Number(form.wht_rate) || 0;
    const whtAmount = Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0));
    const outputTax = computeOutputTax({
      amount,
      entryType: INCOME_REGISTER_ENTRY_TYPE,
      taxInclusive: form.tax_inclusive,
      settings: taxSettings,
    });
    const outstandingBalance = calculateIncomeOutstanding(
      amount,
      amountReceived,
      whtAmount,
    );
    const clientId = form.client_id.trim() || null;
    const otherPayerName = form.customer_name.trim() || null;

    if (!clientId && !otherPayerName) {
      setError("Select a contract client or enter an other payer name.");
      setLoading(false);
      return;
    }

    const payload = {
      date: form.date,
      invoice_no: form.invoice_no,
      client_id: clientId,
      customer_name: clientId ? null : otherPayerName,
      entry_type: INCOME_REGISTER_ENTRY_TYPE,
      service_category: form.service_category,
      description: form.description || null,
      amount,
      amount_received: amountReceived,
      outstanding_balance: outstandingBalance,
      tax_inclusive: form.tax_inclusive,
      net_of_tax_amount: outputTax.netOfTaxAmount,
      output_tax_component: outputTax.component,
      output_vat_amount: outputTax.outputVatAmount,
      wht_rate: whtRate > 0 ? whtRate : null,
      wht_amount: whtAmount,
      payment_status: form.payment_status,
      due_date: form.due_date,
      notes: form.notes || null,
    };

    let savedId = editingId;

    if (editingId) {
      const { error: updateError } = await supabase
        .from("income_register")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("income_register")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !inserted) {
        setError(insertError?.message ?? "Unable to save the income entry.");
        setLoading(false);
        return;
      }

      savedId = (inserted as { id: string }).id;
    }

    const counterpartyName = clientId
      ? (initialClients.find((client) => client.client_id === clientId)
          ?.client_name ?? null)
      : otherPayerName;

    const { error: ledgerError } = await syncIncomeRegisterTaxLedger(supabase, {
      sourceId: savedId as string,
      entryDate: form.date,
      amount,
      whtRatePct: whtRate > 0 ? whtRate : null,
      whtAmount,
      outputTaxComponent: outputTax.component,
      outputTaxRatePct: outputTax.component ? outputTax.ratePct : null,
      outputVatAmount: outputTax.outputVatAmount,
      counterpartyName,
      notes: form.invoice_no ? `Invoice ${form.invoice_no}` : null,
    });

    closeForm();
    await refreshEntries();

    if (ledgerError) {
      setError(
        `Entry saved, but the tax ledger could not be updated: ${ledgerError}`,
      );
    }

    setLoading(false);
  }

  function updateField(field: IncomeFormTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateAmount(value: string) {
    setForm((current) => ({
      ...current,
      amount: value,
      wht_amount: whtAmountEdited
        ? current.wht_amount
        : formatWhtAmount(value, current.wht_rate),
    }));
  }

  function updateWhtRate(value: string) {
    // Picking a rate is an explicit instruction, so it always re-derives the amount.
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      wht_rate: value,
      wht_amount: formatWhtAmount(current.amount, value),
    }));
  }

  function updateWhtAmount(value: string) {
    setWhtAmountEdited(true);
    setForm((current) => ({ ...current, wht_amount: value }));
  }

  const amountValue = Number(form.amount) || 0;
  const previewWhtAmount = Math.max(
    0,
    roundTaxAmount(Number(form.wht_amount) || 0),
  );
  const previewOutputTax = computeOutputTax({
    amount: amountValue,
    entryType: INCOME_REGISTER_ENTRY_TYPE,
    taxInclusive: form.tax_inclusive,
    settings: taxSettings,
  });
  const outputTaxHint = formatOutputTaxHint(
    previewOutputTax,
    form.tax_inclusive,
    formatGHS,
  );
  const previewOutstanding = calculateIncomeOutstanding(
    amountValue,
    Number(form.amount_received) || 0,
    previewWhtAmount,
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track invoices, receipts, and outstanding balances.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Income Entry" : "New Income Entry"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice No.
                </label>
                <input
                  type="text"
                  required
                  value={form.invoice_no}
                  onChange={(e) => updateField("invoice_no", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract Customer
                </label>
                <select
                  value={form.client_id}
                  onChange={(e) => updateField("client_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select contract client</option>
                  {initialClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Other Payer Name
                </label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => updateField("customer_name", e.target.value)}
                  placeholder="Optional — for one-off payers not in clients list"
                  disabled={Boolean(form.client_id)}
                  className={`${inputClassName}${form.client_id ? " bg-slate-50 text-slate-600" : ""}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Service Category
                </label>
                <select
                  required
                  value={form.service_category}
                  onChange={(e) =>
                    updateField("service_category", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {serviceTypes.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => updateAmount(e.target.value)}
                  className={inputClassName}
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.tax_inclusive}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        tax_inclusive: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  Amount includes output tax
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  {outputTaxHint ?? "No output tax on this entry."}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount Received
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount_received}
                  onChange={(e) => updateField("amount_received", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  WHT Rate
                </label>
                <select
                  value={form.wht_rate}
                  onChange={(e) => updateWhtRate(e.target.value)}
                  className={inputClassName}
                >
                  {whtRateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  WHT Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.wht_amount}
                  onChange={(e) => updateWhtAmount(e.target.value)}
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Auto-calculated from Amount × rate. Edit to match the client&apos;s
                  withholding certificate.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <select
                  required
                  value={form.payment_status}
                  onChange={(e) => updateField("payment_status", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select status</option>
                  {PAYMENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Due Date
                </label>
                <input
                  type="date"
                  required
                  value={form.due_date}
                  onChange={(e) => updateField("due_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Outstanding Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOutstanding)}
              </span>{" "}
              <span className="text-xs text-slate-500">
                (Amount − Amount Received − WHT Amount)
              </span>
            </p>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : "Save Entry"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <FilteredListCount
        filteredCount={visibleEntries.length}
        totalCount={entries.length}
        itemSingular="entry"
        hasActiveFilters={anyRegisterColumnFiltersActive(
          serviceCategoryFilter,
          customerNameFilter,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Customer Name"
                  options={customerNameOptions}
                  applied={customerNameFilter}
                  onApply={setCustomerNameFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Service Category"
                  options={serviceCategoryOptions}
                  applied={serviceCategoryFilter}
                  onApply={setServiceCategoryFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Amount Received</th>
              <th className={scrollableTableThClassName}>WHT Amount</th>
              <th className={scrollableTableThClassName}>Outstanding Balance</th>
              <th className={scrollableTableThClassName}>Payment Status</th>
              <th className={scrollableTableThClassName}>Due Date</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No income register entries yet.
                </td>
              </tr>
            ) : visibleEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No entries match the current filters.
                </td>
              </tr>
            ) : (
              visibleEntries.map((entry, index) => {
                const outstanding = getIncomeEntryOutstanding(entry);
                const autoPosted = isAutoPostedIncomeRegisterEntry(entry);

                return (
                  <tr
                    key={entry.id}
                    className={getRegisterRowClassName(index, autoPosted)}
                  >
                    <td className="px-4 py-3">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">{entry.invoice_no}</td>
                    <td className="px-4 py-3">
                      {getIncomeCustomerDisplayName(entry, initialClients)}
                    </td>
                    <td className="px-4 py-3">
                      {entry.service_category ?? "—"}
                      {autoPosted ? (
                        <span className="ml-2 text-xs font-medium opacity-80">
                          (auto-posted)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                    <td className="px-4 py-3">
                      {formatGHS(entry.amount_received)}
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(entry.wht_amount ?? 0)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(outstanding)}</td>
                    <td className="px-4 py-3">{entry.payment_status}</td>
                    <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      deleting={deletingId === entry.id}
                      disableEdit={autoPosted}
                      disableDelete={autoPosted}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <RegisterFilteredTotal
        label="Amount total"
        total={visibleAmountTotal}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
      />
    </div>
  );
}

function formatWhtAmount(amount: string, ratePct: string): string {
  const rate = Number(ratePct) || 0;
  if (rate <= 0) {
    return "";
  }

  return String(computeWhtAmount(Number(amount) || 0, rate));
}
