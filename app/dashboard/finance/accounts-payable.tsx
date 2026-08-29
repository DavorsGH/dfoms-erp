"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";
import { queryExpenseSubcategoryLookups } from "./expense-register-utils";
import {
  calculateBalanceDue,
  calculateDaysOutstanding,
  calculateStatus,
  formatDate,
  formatGHS,
  getPayableGrossBeforeWht,
  getRemainingPayableBalance,
  normalizeAccountsPayableEntry,
  type AccountsPayableEntry,
  type AccountsPayablePaymentSource,
} from "./accounts-payable-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import {
  computePurchaseTaxAmounts,
  computeWhtAmount,
  resolveDefaultWhtRate,
  roundTaxAmount,
  roundTaxRate,
  selectTaxRateOptions,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "./tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncPurchaseTaxLedger,
} from "./tax-ledger-sync";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableStickyFirstTdClassName,
  scrollableTableStickyFirstThClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";

type AccountsPayableProps = {
  initialEntries: AccountsPayableEntry[];
  initialExpenseCategories: NamedLookup[];
  initialExpenseSubcategories: NamedLookup[];
  taxSettings: TaxSettings | null;
  taxRateCatalog: TaxRateCatalogEntry[];
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

type PayableFormState = {
  vendor_name: string;
  invoice_number: string;
  expense_category: string;
  sub_category: string;
  description: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  wht_rate: string;
  wht_amount: string;
  input_vat_amount: string;
  notes: string;
};

const emptyForm: PayableFormState = {
  vendor_name: "",
  invoice_number: "",
  expense_category: "",
  sub_category: "",
  description: "",
  invoice_date: "",
  due_date: "",
  amount: "",
  wht_rate: "0",
  wht_amount: "",
  input_vat_amount: "",
  notes: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const overdueClassName = "font-medium text-red-700";

function formatRateValue(rate: number): string {
  return String(roundTaxRate(rate));
}

function formatWhtAmount(gross: string, ratePct: string): string {
  const rate = Number(ratePct) || 0;
  if (rate <= 0) {
    return "";
  }

  return String(computeWhtAmount(Number(gross) || 0, rate));
}

export default function AccountsPayable({
  initialEntries,
  initialExpenseCategories,
  initialExpenseSubcategories,
  taxSettings,
  taxRateCatalog,
  fetchError,
  activeBusinessUnitId = null,
}: AccountsPayableProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeAccountsPayableEntry),
  );
  const [expenseCategories, setExpenseCategories] = useState(
    initialExpenseCategories,
  );
  const [expenseSubcategories, setExpenseSubcategories] = useState(
    initialExpenseSubcategories,
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [whtAmountEdited, setWhtAmountEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [paymentEntry, setPaymentEntry] = useState<AccountsPayableEntry | null>(
    null,
  );
  const [paymentForm, setPaymentForm] = useState({
    payment_date: "",
    amount: "",
    payment_source: "company_cash" as AccountsPayablePaymentSource,
    notes: "",
  });
  const [recordingPayment, setRecordingPayment] = useState(false);

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

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadLookups() {
      const [
        { data: categories, error: categoriesError },
        { data: subcategories, error: subcategoriesError },
      ] = await Promise.all([
        client
          .from("expense_categories")
          .select("name")
          .order("name", { ascending: true }),
        queryExpenseSubcategoryLookups(client),
      ]);

      const lookupError =
        categoriesError?.message ?? subcategoriesError?.message ?? null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setExpenseCategories(categories ?? []);
      setExpenseSubcategories(subcategories ?? []);
    }

    loadLookups();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as AccountsPayableEntry[] | null) ?? []).map((entry) =>
        normalizeAccountsPayableEntry(entry),
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

  function openEditForm(entry: AccountsPayableEntry) {
    setEditingId(entry.id);
    setWhtAmountEdited(false);
    setForm({
      vendor_name: entry.vendor_name,
      invoice_number: entry.invoice_number,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      description: entry.description ?? "",
      invoice_date: toDateInputValue(entry.invoice_date),
      due_date: toDateInputValue(entry.due_date),
      // Form amount is invoice gross before WHT.
      amount: String(getPayableGrossBeforeWht(entry)),
      wht_rate: formatRateValue(entry.wht_rate ?? 0),
      wht_amount: entry.wht_amount == null ? "" : String(entry.wht_amount),
      input_vat_amount:
        entry.input_vat_amount == null || entry.input_vat_amount === 0
          ? ""
          : String(entry.input_vat_amount),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("accounts_payable")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "accounts_payable",
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

    const grossBeforeWht = Number(form.amount) || 0;
    const existingEntry = editingId
      ? entries.find((entry) => entry.id === editingId)
      : null;
    const amountPaid = existingEntry?.amount_paid ?? 0;
    const whtRate = Number(form.wht_rate) || 0;
    const whtAmount = Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0));
    const inputVatAmount = Math.max(
      0,
      roundTaxAmount(Number(form.input_vat_amount) || 0),
    );
    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht,
      whtRatePct: whtRate,
      whtAmount,
      inputVatAmount,
    });
    // AP amount = net liability to the vendor (gross − WHT).
    const amount = purchaseTax.netPaidToSupplier;
    const balanceDue = calculateBalanceDue(amount, amountPaid);
    const daysOutstanding = calculateDaysOutstanding(form.due_date);
    const status = calculateStatus(balanceDue, daysOutstanding);

    const payload = {
      vendor_name: form.vendor_name,
      invoice_number: form.invoice_number,
      expense_category: form.expense_category,
      sub_category: form.sub_category,
      description: form.description || null,
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      amount,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status,
      gross_before_wht: purchaseTax.grossBeforeWht,
      wht_rate: whtRate > 0 ? whtRate : null,
      wht_amount: purchaseTax.whtAmount,
      input_vat_amount: purchaseTax.inputVatAmount,
      net_of_tax_amount: purchaseTax.netOfTaxAmount,
      notes: form.notes || null,
    };

    let savedId = editingId;

    if (editingId) {
      const { error: updateError } = await supabase
        .from("accounts_payable")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("accounts_payable")
        .insert({
          ...payload,
          business_unit_id: activeBusinessUnitId,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        setError(insertError?.message ?? "Unable to save the payable entry.");
        setLoading(false);
        return;
      }

      savedId = (inserted as { id: string }).id;

      requestTenantAdminDirectorNotification({
        title: "Accounts payable recorded",
        detail: formatGHS(amount),
        actionUrl: "/dashboard/finance/accounts-payable",
      });
    }

    const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
      sourceType: "accounts_payable",
      sourceId: savedId as string,
      entryDate: form.invoice_date,
      grossBeforeWht: purchaseTax.grossBeforeWht,
      whtRatePct: whtRate > 0 ? whtRate : null,
      whtAmount: purchaseTax.whtAmount,
      inputTaxComponent: purchaseTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: purchaseTax.inputVatAmount,
      counterpartyName: form.vendor_name.trim() || null,
      notes: form.invoice_number
        ? `Invoice ${form.invoice_number}`
        : null,
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

  function openRecordPayment(entry: AccountsPayableEntry) {
    setPaymentEntry(entry);
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      amount: "",
      payment_source: "company_cash",
      notes: "",
    });
  }

  function closeRecordPayment() {
    setPaymentEntry(null);
    setPaymentForm({
      payment_date: "",
      amount: "",
      payment_source: "company_cash",
      notes: "",
    });
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentEntry) {
      return;
    }

    setRecordingPayment(true);
    setError(null);

    const amount = Number(paymentForm.amount) || 0;
    if (amount <= 0) {
      setError("Payment amount must be greater than zero.");
      setRecordingPayment(false);
      return;
    }

    const remaining = getRemainingPayableBalance(paymentEntry);
    if (amount > remaining + 0.005) {
      setError(
        `Payment exceeds balance due (${formatGHS(remaining)} remaining).`,
      );
      setRecordingPayment(false);
      return;
    }

    const { tenantId, error: tenantError } =
      await resolveSessionTenantId(supabase);
    if (tenantError || !tenantId) {
      setError(tenantError ?? "Unable to resolve workspace.");
      setRecordingPayment(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("accounts_payable_payments")
      .insert({
        tenant_id: tenantId,
        accounts_payable_id: paymentEntry.id,
        payment_date: paymentForm.payment_date,
        amount,
        payment_source: paymentForm.payment_source,
        notes: paymentForm.notes.trim() || null,
        business_unit_id: paymentEntry.business_unit_id ?? null,
      });

    if (insertError) {
      setError(insertError.message);
      setRecordingPayment(false);
      return;
    }

    const { error: recomputeError } = await supabase.rpc(
      "recompute_accounts_payable_from_payments",
      { p_ap_id: paymentEntry.id },
    );

    closeRecordPayment();
    await refreshEntries();

    if (recomputeError) {
      setError(
        `Payment recorded but payable totals could not be refreshed: ${recomputeError.message}`,
      );
    }

    setRecordingPayment(false);
  }

  function updateField(field: keyof PayableFormState, value: string) {
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

  const previewPurchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: Number(form.amount) || 0,
    whtRatePct: Number(form.wht_rate) || 0,
    whtAmount: Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0)),
    inputVatAmount: Math.max(
      0,
      roundTaxAmount(Number(form.input_vat_amount) || 0),
    ),
  });
  const previewBalanceDue = calculateBalanceDue(
    previewPurchaseTax.netPaidToSupplier,
    editingId
      ? (entries.find((entry) => entry.id === editingId)?.amount_paid ?? 0)
      : 0,
  );
  const previewDaysOutstanding = form.due_date
    ? calculateDaysOutstanding(form.due_date)
    : 0;
  const previewStatus = calculateStatus(
    previewBalanceDue,
    previewDaysOutstanding,
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track vendor invoices, payments, and outstanding balances.
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
            {editingId
              ? "Edit Accounts Payable Entry"
              : "New Accounts Payable Entry"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Vendor Name
                </label>
                <input
                  type="text"
                  required
                  value={form.vendor_name}
                  onChange={(e) => updateField("vendor_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice Number
                </label>
                <input
                  type="text"
                  required
                  value={form.invoice_number}
                  onChange={(e) => updateField("invoice_number", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expense Category
                </label>
                <select
                  required
                  value={form.expense_category}
                  onChange={(e) =>
                    updateField("expense_category", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {expenseCategories.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Sub-Category
                </label>
                <select
                  required
                  value={form.sub_category}
                  onChange={(e) => updateField("sub_category", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select sub-category</option>
                  {expenseSubcategories.map((subcategory) => (
                    <option key={subcategory.name} value={subcategory.name}>
                      {subcategory.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice Date
                </label>
                <input
                  type="date"
                  required
                  value={form.invoice_date}
                  onChange={(e) => updateField("invoice_date", e.target.value)}
                  className={inputClassName}
                />
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
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice Amount (Gross)
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
                <p className="mt-1 text-xs text-slate-500">
                  Supplier invoice total before WHT. Settlements are recorded
                  separately via Record Payment.
                </p>
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
                  Auto-calculated from Gross × rate. Remitted to GRA as
                  wht_payable.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Input VAT Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.input_vat_amount}
                  onChange={(e) =>
                    updateField("input_vat_amount", e.target.value)
                  }
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional — VAT/NHIL/GETFund on this purchase (reclaimable
                  input credit).
                </p>
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

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              <p>
                Net to supplier:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewPurchaseTax.netPaidToSupplier)}
                </span>{" "}
                <span className="text-xs text-slate-500">
                  (Gross − WHT)
                </span>
              </p>
              <p>
                Balance Due:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewBalanceDue)}
                </span>
              </p>
              <p>
                Days Outstanding:{" "}
                <span
                  className={
                    previewStatus === "Overdue"
                      ? overdueClassName
                      : "font-medium text-[#0f2744]"
                  }
                >
                  {previewDaysOutstanding}
                </span>
              </p>
              <p>
                Status:{" "}
                <span
                  className={
                    previewStatus === "Overdue"
                      ? overdueClassName
                      : "font-medium text-[#0f2744]"
                  }
                >
                  {previewStatus}
                </span>
              </p>
            </div>

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

      {paymentEntry ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Record Payment — {paymentEntry.vendor_name} (
            {paymentEntry.invoice_number})
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            Balance due:{" "}
            <span className="font-medium text-[#0f2744]">
              {formatGHS(getRemainingPayableBalance(paymentEntry))}
            </span>
            . Record multiple partial payments with different sources if needed.
          </p>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Date
                </label>
                <input
                  type="date"
                  required
                  value={paymentForm.payment_date}
                  onChange={(e) =>
                    setPaymentForm((current) => ({
                      ...current,
                      payment_date: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm((current) => ({
                      ...current,
                      amount: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Source
                </label>
                <select
                  required
                  value={paymentForm.payment_source}
                  onChange={(e) =>
                    setPaymentForm((current) => ({
                      ...current,
                      payment_source: e.target
                        .value as AccountsPayablePaymentSource,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="company_cash">Company cash</option>
                  <option value="directors_loan">
                    Director (personal funds)
                  </option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) =>
                    setPaymentForm((current) => ({
                      ...current,
                      notes: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={recordingPayment}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recordingPayment ? "Recording…" : "Record Payment"}
              </button>
              <button
                type="button"
                onClick={closeRecordPayment}
                disabled={recordingPayment}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <FilteredListCount
        filteredCount={entries.length}
        totalCount={entries.length}
        itemSingular="entry"
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableStickyFirstThClassName}>Vendor Name</th>
                <th className={scrollableTableThClassName}>Invoice Number</th>
                <th className={scrollableTableThClassName}>Expense Category</th>
                <th className={scrollableTableThClassName}>Sub-Category</th>
                <th className={scrollableTableThClassName}>Invoice Date</th>
                <th className={scrollableTableThClassName}>Due Date</th>
                <th className={scrollableTableThClassName}>Gross</th>
                <th className={scrollableTableThClassName}>WHT</th>
                <th className={scrollableTableThClassName}>Net Amount</th>
                <th className={scrollableTableThClassName}>Amount Paid</th>
                <th className={scrollableTableThClassName}>Balance Due</th>
                <th className={scrollableTableThClassName}>Days Outstanding</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No accounts payable entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry, index) => {
                  const balanceDue = calculateBalanceDue(
                    entry.amount,
                    entry.amount_paid,
                  );
                  const daysOutstanding = calculateDaysOutstanding(
                    entry.due_date,
                  );
                  const status = calculateStatus(balanceDue, daysOutstanding);
                  const isOverdue = status === "Overdue";
                  const gross = getPayableGrossBeforeWht(entry);

                  return (
                    <tr
                      key={entry.id}
                      className={getStripedRowClassName(index)}
                    >
                      <td
                        className={scrollableTableStickyFirstTdClassName({
                          striped: index % 2 === 1,
                        })}
                      >
                        {entry.vendor_name}
                      </td>
                      <td className="px-4 py-3">{entry.invoice_number}</td>
                      <td className="px-4 py-3">{entry.expense_category}</td>
                      <td className="px-4 py-3">{entry.sub_category}</td>
                      <td className="px-4 py-3">
                        {formatDate(entry.invoice_date)}
                      </td>
                      <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                      <td className="px-4 py-3">{formatGHS(gross)}</td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.wht_amount ?? 0)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.amount_paid)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(balanceDue)}</td>
                      <td
                        className={`px-4 py-3 ${isOverdue ? overdueClassName : ""}`}
                      >
                        {daysOutstanding}
                      </td>
                      <td
                        className={`px-4 py-3 ${isOverdue ? overdueClassName : ""}`}
                      >
                        {status}
                      </td>
                      <RegisterRowActions
                        onEdit={() => openEditForm(entry)}
                        onDelete={() => handleDelete(entry.id)}
                        onMarkPaid={
                          getRemainingPayableBalance(entry) > 0
                            ? () => openRecordPayment(entry)
                            : undefined
                        }
                        markPaidLabel="Record Payment"
                        deleting={deletingId === entry.id}
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
