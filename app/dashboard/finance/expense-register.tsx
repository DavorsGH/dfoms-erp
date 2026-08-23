"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { mapApproverRows } from "../approver-utils";
import type { Approver, NamedLookup } from "../lookup-types";
import {
  calculateAmount,
  formatDate,
  formatGHS,
  getExpenseGrossBeforeWht,
  normalizeExpenseRegisterEntry,
  type ExpenseRegisterEntry,
} from "./expense-register-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { resolveManualExpenseReceiptNo } from "./expense-register-api";
import {
  canMarkAutoPostedExpenseAsPaid,
  getRegisterRowClassName,
  isAutoPostedExpenseRegisterEntry,
  isPayrollEssnitExpense,
  markAutoPostedExpensePaid,
} from "./register-auto-posted-utils";
import {
  fetchLinkedProductSaleCogsByExpenseId,
  formatLinkedProductSaleCogsDeleteMessage,
  isIncomeRegisterCogsExpenseFkError,
  lookupLinkedProductSaleCogsForExpense,
  type LinkedProductSaleCogs,
} from "./product-sale-cogs-expense-utils";
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
  toDateInputValue,
} from "./register-row-actions";
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
  scrollableTableStickyFirstWrapTdClassName,
  scrollableTableStickyFirstWrapThClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
import type { SupplierRow } from "@/utils/suppliers-types";
import {
  inferVendorSelectState,
  resolveVendorNameFromSelect,
  VENDOR_OTHER_VALUE,
} from "./vendor-select-utils";

type ExpenseRegisterProps = {
  initialEntries: ExpenseRegisterEntry[];
  initialExpenseCategories: NamedLookup[];
  initialExpenseSubcategories: NamedLookup[];
  initialPaymentMethods: NamedLookup[];
  initialApprovers: Approver[];
  initialSuppliers: SupplierRow[];
  taxSettings: TaxSettings | null;
  taxRateCatalog: TaxRateCatalogEntry[];
  fetchError: string | null;
};

type ExpenseFormState = {
  date: string;
  expense_category: string;
  sub_category: string;
  description: string;
  vendor_select: string;
  vendor_other: string;
  price: string;
  quantity: string;
  payment_method: string;
  approved_by: string;
  receipt_no: string;
  payment_status: string;
  has_wht_vat: boolean;
  wht_rate: string;
  wht_amount: string;
  input_vat_amount: string;
  notes: string;
};

const emptyForm: ExpenseFormState = {
  date: "",
  expense_category: "",
  sub_category: "",
  description: "",
  vendor_select: "",
  vendor_other: "",
  price: "",
  quantity: "",
  payment_method: "",
  approved_by: "",
  receipt_no: "",
  payment_status: "",
  has_wht_vat: false,
  wht_rate: "0",
  wht_amount: "",
  input_vat_amount: "",
  notes: "",
};

const PAYMENT_STATUS_OPTIONS = [
  "Pending",
  "Partial",
  "Paid",
  "Overdue",
  "Accrued",
  "Accrued - Not Yet Paid",
  "Settled (No Cash Impact)",
];

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

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

export default function ExpenseRegister({
  initialEntries,
  initialExpenseCategories,
  initialExpenseSubcategories,
  initialPaymentMethods,
  initialApprovers,
  initialSuppliers,
  taxSettings,
  taxRateCatalog,
  fetchError,
}: ExpenseRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeExpenseRegisterEntry),
  );
  const [categoryFilter, setCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [subCategoryFilter, setSubCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [descriptionFilter, setDescriptionFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [expenseCategories, setExpenseCategories] = useState(
    initialExpenseCategories,
  );
  const [expenseSubcategories, setExpenseSubcategories] = useState(
    initialExpenseSubcategories,
  );
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [approvers, setApprovers] = useState(initialApprovers);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Once the user types a WHT amount we stop overwriting it from Gross × rate.
  const [whtAmountEdited, setWhtAmountEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [linkedProductSaleCogsByExpenseId, setLinkedProductSaleCogsByExpenseId] =
    useState<Map<string, LinkedProductSaleCogs>>(() => new Map());

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

  const categoryOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter),
          )
          .map((entry) => entry.expense_category),
      ),
    [entries, subCategoryFilter, descriptionFilter],
  );

  const subCategoryOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter),
          )
          .map((entry) => entry.sub_category),
      ),
    [entries, categoryFilter, descriptionFilter],
  );

  const descriptionOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter),
          )
          .map((entry) => entry.description),
      ),
    [entries, categoryFilter, subCategoryFilter],
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          columnValuePassesFilter(entry.expense_category, categoryFilter) &&
          columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
          columnValuePassesFilter(entry.description, descriptionFilter),
      ),
    [entries, categoryFilter, subCategoryFilter, descriptionFilter],
  );

  const visibleNetPaidTotal = useMemo(() => {
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

    async function loadLookups() {
      const { tenantId } = await resolveSessionTenantId(client);

      const supplierQuery = tenantId
        ? client
            .from("suppliers")
            .select("id, tenant_id, name, contact_person, phone, email, address, payment_terms_days, is_active, created_at, updated_at")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .order("name", { ascending: true })
        : Promise.resolve({ data: [], error: null });

      const [
        { data: categories, error: categoriesError },
        { data: subcategories, error: subcategoriesError },
        { data: methods, error: methodsError },
        { data: approverRows, error: approversError },
        { data: supplierRows, error: suppliersError },
      ] = await Promise.all([
        client
          .from("expense_categories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("expense_subcategories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("payment_methods")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("approvers")
          .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
          .order("employee_id", { ascending: true }),
        supplierQuery,
      ]);

      const lookupError =
        categoriesError?.message ??
        subcategoriesError?.message ??
        methodsError?.message ??
        approversError?.message ??
        suppliersError?.message ??
        null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setExpenseCategories(categories ?? []);
      setExpenseSubcategories(subcategories ?? []);
      setPaymentMethods(methods ?? []);
      setApprovers(mapApproverRows(approverRows ?? []));
      setSuppliers((supplierRows as SupplierRow[] | null) ?? []);
    }

    loadLookups();
  }, [showForm]);

  useEffect(() => {
    void (async () => {
      try {
        const linked = await fetchLinkedProductSaleCogsByExpenseId(supabase);
        setLinkedProductSaleCogsByExpenseId(linked);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load linked product sale COGS entries.",
        );
      }
    })();
    // Load linked product-sale COGS map once on mount (shared client instance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLinkedProductSaleCogs() {
    const linked = await fetchLinkedProductSaleCogsByExpenseId(supabase);
    setLinkedProductSaleCogsByExpenseId(linked);
  }

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("expense_register")
      .select("*")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as ExpenseRegisterEntry[] | null) ?? []).map((entry) =>
        normalizeExpenseRegisterEntry(entry),
      ),
    );
    setError(null);

    try {
      await refreshLinkedProductSaleCogs();
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not refresh linked product sale COGS entries.",
      );
    }
  }

  function openAddForm() {
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: ExpenseRegisterEntry) {
    const linkedProductSaleCogs = linkedProductSaleCogsByExpenseId.get(
      entry.id,
    );
    if (linkedProductSaleCogs) {
      setError(formatLinkedProductSaleCogsDeleteMessage(linkedProductSaleCogs));
      return;
    }

    if (isAutoPostedExpenseRegisterEntry(entry)) {
      setError(
        "Payroll auto-posted expenses cannot be edited here. Use Mark as Paid when remitting Accrued Employer SSNIT / Accrued Staff Salaries, or Release payroll to reverse the post.",
      );
      return;
    }
    setEditingId(entry.id);
    setWhtAmountEdited(false);
    const vendorState = inferVendorSelectState(entry.vendor, suppliers);
    const hasTax =
      (entry.wht_rate ?? 0) > 0 ||
      (entry.wht_amount ?? 0) > 0 ||
      (entry.input_vat_amount ?? 0) > 0;
    setForm({
      date: toDateInputValue(entry.date),
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      description: entry.description ?? "",
      vendor_select: vendorState.vendorSelect,
      vendor_other: vendorState.vendorOther,
      price: String(entry.price),
      quantity: String(entry.quantity),
      payment_method: entry.payment_method,
      approved_by: entry.approved_by,
      receipt_no: entry.receipt_no,
      payment_status: entry.payment_status,
      has_wht_vat: hasTax,
      wht_rate: hasTax ? formatRateValue(entry.wht_rate ?? 0) : "0",
      wht_amount: entry.wht_amount == null ? "" : String(entry.wht_amount),
      input_vat_amount:
        entry.input_vat_amount == null || entry.input_vat_amount === 0
          ? ""
          : String(entry.input_vat_amount),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleMarkAsPaid(entry: ExpenseRegisterEntry) {
    if (!canMarkAutoPostedExpenseAsPaid(entry)) {
      return;
    }

    const essnit = isPayrollEssnitExpense(entry);
    const confirmMessage = essnit
      ? `Mark this Employer SSNIT expense as Paid? This posts a Cash Position outflow for ${formatGHS(entry.amount)} and remits matching employer SSNIT Tax Ledger legs (Tier 1 + Tier 2) for the payroll period. Employee SSNIT remains open — use Statutory Ledger → Remit SSNIT for period for the remaining employee remittance (employer cash will not be posted again).`
      : `Mark this Staff Salaries expense as Paid? This posts a Cash Position outflow for ${formatGHS(entry.amount)} and clears Accrued Wages for the period.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setMarkingPaidId(entry.id);
    setError(null);

    const result = await markAutoPostedExpensePaid(supabase, entry);
    if (result.error) {
      setError(result.error);
      setMarkingPaidId(null);
      await refreshEntries();
      return;
    }

    await refreshEntries();
    setMarkingPaidId(null);
  }

  async function handleDelete(id: string) {
    const knownLink = linkedProductSaleCogsByExpenseId.get(id);
    if (knownLink) {
      setError(formatLinkedProductSaleCogsDeleteMessage(knownLink));
      return;
    }

    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    let linkedProductSaleCogs: LinkedProductSaleCogs | null = null;
    try {
      linkedProductSaleCogs = await lookupLinkedProductSaleCogsForExpense(
        supabase,
        id,
      );
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : "Could not verify whether this expense is linked to a product sale.",
      );
      setDeletingId(null);
      return;
    }

    if (linkedProductSaleCogs) {
      setLinkedProductSaleCogsByExpenseId((current) => {
        const next = new Map(current);
        next.set(id, linkedProductSaleCogs!);
        return next;
      });
      setError(
        formatLinkedProductSaleCogsDeleteMessage(linkedProductSaleCogs),
      );
      setDeletingId(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("expense_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      if (isIncomeRegisterCogsExpenseFkError(deleteError)) {
        try {
          const fallbackLink = await lookupLinkedProductSaleCogsForExpense(
            supabase,
            id,
          );
          if (fallbackLink) {
            setLinkedProductSaleCogsByExpenseId((current) => {
              const next = new Map(current);
              next.set(id, fallbackLink);
              return next;
            });
            setError(formatLinkedProductSaleCogsDeleteMessage(fallbackLink));
          } else {
            setError(
              "This expense is linked to a product sale and cannot be deleted directly. Void the original sale from Sales & CRM → Sales Log instead.",
            );
          }
        } catch {
          setError(
            "This expense is linked to a product sale and cannot be deleted directly. Void the original sale from Sales & CRM → Sales Log instead.",
          );
        }
      } else {
        setError(deleteError.message);
      }
      setDeletingId(null);
      return;
    }

    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "expense_register",
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

    const price = Number(form.price);
    const quantity = form.quantity.trim() === "" ? 1 : Number(form.quantity);
    const grossBeforeWht = calculateAmount(price, quantity);
    const vendorName = resolveVendorNameFromSelect(
      form.vendor_select,
      form.vendor_other,
      suppliers,
    );
    if (!vendorName) {
      setError("Vendor is required.");
      setLoading(false);
      return;
    }
    if (form.vendor_select === VENDOR_OTHER_VALUE && !form.vendor_other.trim()) {
      setError("Enter the one-time vendor name.");
      setLoading(false);
      return;
    }

    const whtRate = form.has_wht_vat ? Number(form.wht_rate) || 0 : 0;
    const whtAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0))
      : 0;
    const inputVatAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.input_vat_amount) || 0))
      : 0;
    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht,
      whtRatePct: whtRate,
      whtAmount,
      inputVatAmount,
    });

    let receiptNo = form.receipt_no.trim();
    if (!editingId) {
      // Create only: blank → generate_next_code('EXP'); filled → keep vendor paper receipt #.
      const resolved = await resolveManualExpenseReceiptNo(supabase, form.receipt_no);
      if (resolved.error || !resolved.receiptNo) {
        setError(resolved.error ?? "Unable to allocate receipt number.");
        setLoading(false);
        return;
      }
      receiptNo = resolved.receiptNo;
    }

    // amount = net paid to supplier (gross − WHT); price×qty remains the gross line.
    const payload = {
      date: form.date,
      expense_category: form.expense_category,
      sub_category: form.sub_category,
      description: form.description || null,
      vendor: vendorName,
      price,
      quantity,
      amount: purchaseTax.netPaidToSupplier,
      payment_method: form.payment_method,
      approved_by: form.approved_by,
      receipt_no: receiptNo,
      payment_status: form.payment_status,
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
        .from("expense_register")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("expense_register")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !inserted) {
        setError(insertError?.message ?? "Unable to save the expense entry.");
        setLoading(false);
        return;
      }

      savedId = (inserted as { id: string }).id;

      requestTenantAdminDirectorNotification({
        title: "New expense recorded",
        detail: formatGHS(purchaseTax.netPaidToSupplier),
        actionUrl: "/dashboard/finance/expenses",
      });
    }

    const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
      sourceType: "expense_register",
      sourceId: savedId as string,
      entryDate: form.date,
      grossBeforeWht: purchaseTax.grossBeforeWht,
      whtRatePct: whtRate > 0 ? whtRate : null,
      whtAmount: purchaseTax.whtAmount,
      inputTaxComponent: purchaseTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: purchaseTax.inputVatAmount,
      counterpartyName: vendorName || null,
      notes: receiptNo ? `Receipt ${receiptNo}` : null,
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

  function updateField<K extends keyof ExpenseFormState>(
    field: K,
    value: ExpenseFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleHasWhtVat(checked: boolean) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      has_wht_vat: checked,
      wht_rate: checked ? defaultWhtRate : "0",
      wht_amount: checked
        ? formatWhtAmount(currentGrossString(current), defaultWhtRate)
        : "",
      input_vat_amount: checked ? current.input_vat_amount : "",
    }));
  }

  function currentGrossString(next?: Partial<ExpenseFormState>): string {
    const price = Number(next?.price ?? form.price) || 0;
    const quantityRaw = (next?.quantity ?? form.quantity).trim();
    const quantity = quantityRaw === "" ? 1 : Number(quantityRaw) || 1;
    return String(calculateAmount(price, quantity));
  }

  function updatePrice(value: string) {
    setForm((current) => {
      const next = { ...current, price: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateQuantity(value: string) {
    setForm((current) => {
      const next = { ...current, quantity: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateWhtRate(value: string) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      wht_rate: value,
      wht_amount: formatWhtAmount(currentGrossString(current), value),
    }));
  }

  function updateWhtAmount(value: string) {
    setWhtAmountEdited(true);
    setForm((current) => ({ ...current, wht_amount: value }));
  }

  const previewGross = calculateAmount(
    Number(form.price) || 0,
    form.quantity.trim() === "" ? 1 : Number(form.quantity) || 1,
  );
  const previewPurchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: previewGross,
    whtRatePct: form.has_wht_vat ? Number(form.wht_rate) || 0 : 0,
    whtAmount: form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0))
      : 0,
    inputVatAmount: form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.input_vat_amount) || 0))
      : 0,
  });

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Track expenses, receipts, and payment status.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/bulk-import?type=expense"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Bulk Import
          </Link>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Entry"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Expense Entry" : "New Expense Entry"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expense Name
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={inputClassName}
                />
              </div>
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
                  Vendor
                </label>
                <select
                  required
                  value={form.vendor_select}
                  onChange={(e) => updateField("vendor_select", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select vendor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                  <option value={VENDOR_OTHER_VALUE}>Other (one-time vendor)</option>
                </select>
              </div>
              {form.vendor_select === VENDOR_OTHER_VALUE ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    One-time vendor name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.vendor_other}
                    onChange={(e) => updateField("vendor_other", e.target.value)}
                    className={inputClassName}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Price
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => updatePrice(e.target.value)}
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Unit price before WHT (gross line = Price × Quantity).
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(e) => updateQuantity(e.target.value)}
                  placeholder="1"
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.has_wht_vat}
                    onChange={(e) => toggleHasWhtVat(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  This expense has WHT/VAT
                </label>
              </div>
              {form.has_wht_vat ? (
                <>
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
                      Auto-calculated from Gross × rate. Edit to match the
                      withholding certificate.
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
                </>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={form.payment_method}
                  onChange={(e) => updateField("payment_method", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  required
                  value={form.approved_by}
                  onChange={(e) => updateField("approved_by", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select approver</option>
                  {approvers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Receipt No.
                </label>
                <input
                  type="text"
                  value={form.receipt_no}
                  onChange={(e) => updateField("receipt_no", e.target.value)}
                  placeholder={
                    editingId
                      ? undefined
                      : "Leave blank to auto-assign, or enter vendor receipt #"
                  }
                  className={inputClassName}
                />
                {!editingId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Leave blank for an internal code (e.g. DF-EXP-0001), or type
                    the number printed on the vendor&apos;s paper receipt.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <select
                  required
                  value={form.payment_status}
                  onChange={(e) =>
                    updateField("payment_status", e.target.value)
                  }
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
                Gross (before WHT):{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewPurchaseTax.grossBeforeWht)}
                </span>
              </p>
              <p>
                Net paid to supplier:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewPurchaseTax.netPaidToSupplier)}
                </span>{" "}
                <span className="text-xs text-slate-500">
                  (Gross − WHT — cash outflow / amount saved)
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

      <FilteredListCount
        filteredCount={visibleEntries.length}
        totalCount={entries.length}
        itemSingular="entry"
        hasActiveFilters={anyRegisterColumnFiltersActive(
          categoryFilter,
          subCategoryFilter,
          descriptionFilter,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableStickyFirstWrapThClassName}>
                  <RegisterColumnFilterHeader
                    label="Expense Name"
                    options={descriptionOptions}
                    applied={descriptionFilter}
                    onApply={setDescriptionFilter}
                  />
                </th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Expense Category"
                    options={categoryOptions}
                    applied={categoryFilter}
                    onApply={setCategoryFilter}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Sub-Category"
                    options={subCategoryOptions}
                    applied={subCategoryFilter}
                    onApply={setSubCategoryFilter}
                  />
                </th>
                <th className={scrollableTableThClassName}>Vendor</th>
                <th className={scrollableTableThClassName}>Gross</th>
                <th className={scrollableTableThClassName}>WHT</th>
                <th className={scrollableTableThClassName}>Net Paid</th>
                <th className={scrollableTableThClassName}>Payment Method</th>
                <th className={scrollableTableThClassName}>Payment Status</th>
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
                    No expense register entries yet.
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
                  const gross = getExpenseGrossBeforeWht(entry);
                  const autoPosted = isAutoPostedExpenseRegisterEntry(entry);
                  const linkedProductSaleCogs =
                    linkedProductSaleCogsByExpenseId.get(entry.id) ?? null;
                  const systemLinked = autoPosted || linkedProductSaleCogs != null;
                  const showMarkPaid = canMarkAutoPostedExpenseAsPaid(entry);
                  const deleteBlockedMessage = linkedProductSaleCogs
                    ? formatLinkedProductSaleCogsDeleteMessage(
                        linkedProductSaleCogs,
                      )
                    : undefined;

                  return (
                    <tr
                      key={entry.id}
                      className={getRegisterRowClassName(index, systemLinked)}
                    >
                      <td
                        className={scrollableTableStickyFirstWrapTdClassName({
                          striped: index % 2 === 1,
                        })}
                      >
                        {entry.description ?? "—"}
                        {autoPosted ? (
                          <span className="ml-2 text-xs font-medium opacity-80">
                            (auto-posted)
                          </span>
                        ) : linkedProductSaleCogs ? (
                          <span className="ml-2 text-xs font-medium opacity-80">
                            (product sale COGS)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{formatDate(entry.date)}</td>
                      <td className="px-4 py-3">{entry.expense_category}</td>
                      <td className="px-4 py-3">{entry.sub_category}</td>
                      <td className="px-4 py-3">{entry.vendor}</td>
                      <td className="px-4 py-3">{formatGHS(gross)}</td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.wht_amount ?? 0)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                      <td className="px-4 py-3">{entry.payment_method}</td>
                      <td className="px-4 py-3">{entry.payment_status}</td>
                      <RegisterRowActions
                        onEdit={() => openEditForm(entry)}
                        onDelete={
                          linkedProductSaleCogs
                            ? undefined
                            : () => handleDelete(entry.id)
                        }
                        deleting={deletingId === entry.id}
                        disableEdit={systemLinked}
                        disableDelete={linkedProductSaleCogs != null}
                        deleteDisabledTitle={deleteBlockedMessage}
                        onMarkPaid={
                          showMarkPaid
                            ? () => {
                                void handleMarkAsPaid(entry);
                              }
                            : undefined
                        }
                        markingPaid={markingPaidId === entry.id}
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
        </table>
      </ScrollableTable>

      <RegisterFilteredTotal
        label="Net Paid total"
        total={visibleNetPaidTotal}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
      />
    </div>
  );
}
