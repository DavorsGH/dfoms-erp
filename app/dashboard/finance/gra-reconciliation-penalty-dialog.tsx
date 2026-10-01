"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  validateNewExpenseRegisterCategory,
  validateNewExpenseRegisterSubcategory,
} from "@/utils/expense-register-category-guard";
import { lookupOptionLabel } from "../administration/lookup-settings-shared";
import {
  GRA_PENALTY_EXPENSE_CATEGORY,
  buildGraPenaltyExpenseDescription,
  findSimilarGraPenaltyExpense,
  type SimilarPenaltyExpense,
} from "./gra-penalty-expense-utils";
import { createManualExpenseRegisterEntry } from "./manual-expense-register-create";
import type { GraReconciliationKind } from "./statutory-due-rules";
import { resolveGraPenaltyDialogDefaults } from "./gra-penalty-dialog-defaults";
import { formatGHS } from "./tax-ledger-utils";
import type { VatReturnPeriod } from "./tax-utils";
import {
  ExpenseRegisterReceiptNoField,
  ExpenseRegisterSubCategorySelect,
  ExpenseRegisterSupplierFields,
  expenseCategorySelectOptionsForCreate,
  expenseRegisterInputClassName,
  toVendorSupplierOptions,
} from "./expense-register-form-fields";
import { useExpenseRegisterCreateLookups } from "./use-expense-register-create-lookups";
import {
  resolveVendorNameFromSelect,
  VENDOR_OTHER_VALUE,
} from "./vendor-select-utils";

const PAYMENT_STATUS_OPTIONS = [
  "Pending",
  "Partial",
  "Paid",
  "Overdue",
  "Accrued",
  "Accrued - Not Yet Paid",
  "Settled (No Cash Impact)",
];

const DEFAULT_GRA_VENDOR_NAME = "Ghana Revenue Authority (GRA)";

export function GraReconciliationPenaltyDialog({
  tenantId,
  businessUnitId,
  periodMonth,
  kind,
  penaltyAmount,
  dueDateIso,
  hasRemittedLedgerActivity,
  vatReturnPeriod,
  onClose,
  onSaved,
}: {
  tenantId: string;
  businessUnitId: string | null;
  periodMonth: string;
  kind: GraReconciliationKind;
  penaltyAmount: number;
  dueDateIso: string;
  hasRemittedLedgerActivity: boolean;
  vatReturnPeriod: VatReturnPeriod;
  onClose: () => void;
  onSaved: (expenseId: string, expenseDate: string, amount: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const createLookups = useExpenseRegisterCreateLookups({ enabled: true });

  const [date, setDate] = useState("");
  const [expenseCategory, setExpenseCategory] = useState(
    GRA_PENALTY_EXPENSE_CATEGORY,
  );
  const [subCategory, setSubCategory] = useState("");
  const [description, setDescription] = useState(() =>
    buildGraPenaltyExpenseDescription(kind, periodMonth),
  );
  const [vendorSelect, setVendorSelect] = useState("");
  const [vendorOther, setVendorOther] = useState(DEFAULT_GRA_VENDOR_NAME);
  const [receiptNo, setReceiptNo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [dateDefaultNote, setDateDefaultNote] = useState<string | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [vendorDefaultsApplied, setVendorDefaultsApplied] = useState(false);
  const dateEditedRef = useRef(false);
  const paymentStatusEditedRef = useRef(false);
  const paymentMethodEditedRef = useRef(false);
  const [similarExpense, setSimilarExpense] =
    useState<SimilarPenaltyExpense | null>(null);
  const [recordAnyway, setRecordAnyway] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const expenseCategoryOptions = useMemo(
    () =>
      expenseCategorySelectOptionsForCreate(
        createLookups.expenseCategories,
        false,
        expenseCategory,
      ),
    [createLookups.expenseCategories, expenseCategory],
  );

  useEffect(() => {
    if (createLookups.error) {
      setError(createLookups.error);
    }
  }, [createLookups.error]);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaults() {
      setDefaultsLoading(true);
      const resolved = await resolveGraPenaltyDialogDefaults({
        supabase,
        tenantId,
        businessUnitId,
        periodMonth,
        kind,
        dueDateIso,
        hasRemittedLedgerActivity,
        vatReturnPeriod,
      });

      if (cancelled) {
        return;
      }

      if (!dateEditedRef.current) {
        setDate(resolved.date);
      }
      if (!paymentStatusEditedRef.current) {
        setPaymentStatus(resolved.paymentStatus);
      }
      if (!paymentMethodEditedRef.current && resolved.paymentMethod) {
        setPaymentMethod(resolved.paymentMethod);
      }
      setDateDefaultNote(resolved.dateDefaultNote);
      setDefaultsLoading(false);
    }

    void loadDefaults();

    return () => {
      cancelled = true;
    };
  }, [
    businessUnitId,
    dueDateIso,
    hasRemittedLedgerActivity,
    kind,
    periodMonth,
    supabase,
    tenantId,
    vatReturnPeriod,
  ]);

  useEffect(() => {
    if (
      vendorDefaultsApplied ||
      createLookups.loading ||
      defaultsLoading
    ) {
      return;
    }

    const graMatch = createLookups.suppliers.find(
      (supplier) =>
        supplier.name.localeCompare(DEFAULT_GRA_VENDOR_NAME, undefined, {
          sensitivity: "accent",
        }) === 0,
    );

    if (graMatch) {
      setVendorSelect(graMatch.id);
      setVendorOther("");
    } else {
      setVendorSelect(VENDOR_OTHER_VALUE);
      setVendorOther(DEFAULT_GRA_VENDOR_NAME);
    }

    if (
      !paymentMethodEditedRef.current &&
      !paymentMethod.trim() &&
      createLookups.paymentMethods[0]?.name
    ) {
      setPaymentMethod(createLookups.paymentMethods[0].name);
    }

    if (createLookups.approvers[0]?.full_name) {
      setApprovedBy(createLookups.approvers[0].full_name);
    }

    setVendorDefaultsApplied(true);
  }, [
    createLookups.approvers,
    createLookups.loading,
    createLookups.paymentMethods,
    createLookups.suppliers,
    defaultsLoading,
    vendorDefaultsApplied,
    paymentMethod,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function checkDuplicate() {
      setCheckingDuplicate(true);
      const match = await findSimilarGraPenaltyExpense({
        supabase,
        tenantId,
        businessUnitId,
        kind,
        periodMonth,
        penaltyAmount,
        dueDateIso,
      });
      if (!cancelled) {
        setSimilarExpense(match);
        setCheckingDuplicate(false);
      }
    }

    void checkDuplicate();

    return () => {
      cancelled = true;
    };
  }, [
    businessUnitId,
    dueDateIso,
    kind,
    penaltyAmount,
    periodMonth,
    supabase,
    tenantId,
  ]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (similarExpense && !recordAnyway) {
      setError('Confirm "Record anyway" to continue.');
      return;
    }

    const categoryError = validateNewExpenseRegisterCategory(expenseCategory, {
      categoryRows: createLookups.expenseCategories,
    });
    if (categoryError) {
      setError(categoryError);
      return;
    }

    const subcategoryError = validateNewExpenseRegisterSubcategory(
      expenseCategory,
      subCategory,
      createLookups.expenseSubcategories,
      createLookups.expenseCategories,
    );
    if (subcategoryError) {
      setError(subcategoryError);
      return;
    }

    if (!subCategory.trim()) {
      setError("Sub-category is required.");
      return;
    }

    const vendorName = resolveVendorNameFromSelect(
      vendorSelect,
      vendorOther,
      toVendorSupplierOptions(createLookups.suppliers),
    );
    if (!vendorName) {
      setError("Supplier is required.");
      return;
    }
    if (vendorSelect === VENDOR_OTHER_VALUE && !vendorOther.trim()) {
      setError("Enter the one-time supplier name.");
      return;
    }

    if (!paymentMethod.trim()) {
      setError("Payment method is required.");
      return;
    }

    if (!approvedBy.trim()) {
      setError("Approved by is required.");
      return;
    }

    setSubmitting(true);

    const result = await createManualExpenseRegisterEntry(supabase, {
      date,
      expense_category: expenseCategory,
      sub_category: subCategory,
      description,
      vendor: vendorName,
      price: penaltyAmount,
      quantity: 1,
      payment_method: paymentMethod,
      approved_by: approvedBy,
      receipt_no: receiptNo.trim() || undefined,
      payment_status: paymentStatus,
      business_unit_id: businessUnitId,
    });

    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    if (result.ledgerError) {
      setError(
        `Expense saved, but tax ledger sync failed: ${result.ledgerError}`,
      );
      setSubmitting(false);
      return;
    }

    onSaved(result.expenseId, date, penaltyAmount);
    onClose();
  }

  const lookupsLoading = createLookups.loading || defaultsLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gra-penalty-expense-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3
          id="gra-penalty-expense-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          Record difference as expense
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Penalty / interest amount {formatGHS(penaltyAmount)} (GRA portal
          exceeds ledger total for this period).
        </p>

        {checkingDuplicate ? (
          <p className="mt-3 text-sm text-slate-500">Checking for duplicates…</p>
        ) : similarExpense ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-medium">A similar expense may already exist:</p>
            <p className="mt-1">
              {similarExpense.date}
              {similarExpense.description
                ? ` — ${similarExpense.description}`
                : ""}{" "}
              — {formatGHS(similarExpense.amount)}
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={recordAnyway}
                onChange={(event) => setRecordAnyway(event.target.checked)}
              />
              Record anyway
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-red-700">{error}</p>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(event) => {
                dateEditedRef.current = true;
                setDate(event.target.value);
              }}
              className={expenseRegisterInputClassName}
              disabled={defaultsLoading}
            />
            {dateDefaultNote ? (
              <p className="mt-1 text-xs text-slate-500">{dateDefaultNote}</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Expense Category
            </label>
            <select
              required
              value={expenseCategory}
              onChange={(event) => {
                setExpenseCategory(event.target.value);
                setSubCategory("");
              }}
              className={expenseRegisterInputClassName}
              disabled={lookupsLoading}
            >
              <option value="">Select category</option>
              {expenseCategoryOptions.map((category) => (
                <option key={category.name} value={category.name}>
                  {lookupOptionLabel(category.name, category.is_active)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Sub-Category
            </label>
            <ExpenseRegisterSubCategorySelect
              expenseCategory={expenseCategory}
              value={subCategory}
              onChange={setSubCategory}
              allSubcategories={createLookups.expenseSubcategories}
              expenseCategories={createLookups.expenseCategories}
              disabled={lookupsLoading}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Expense Name
            </label>
            <textarea
              required
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={expenseRegisterInputClassName}
            />
          </div>
          <ExpenseRegisterSupplierFields
            vendorSelect={vendorSelect}
            vendorOther={vendorOther}
            onVendorSelectChange={setVendorSelect}
            onVendorOtherChange={setVendorOther}
            suppliers={toVendorSupplierOptions(createLookups.suppliers)}
            disabled={lookupsLoading}
          />
          <ExpenseRegisterReceiptNoField
            value={receiptNo}
            onChange={setReceiptNo}
            isCreate
            disabled={lookupsLoading}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Payment Method
              </label>
              <select
                required
                value={paymentMethod}
                onChange={(event) => {
                  paymentMethodEditedRef.current = true;
                  setPaymentMethod(event.target.value);
                }}
                className={expenseRegisterInputClassName}
                disabled={lookupsLoading}
              >
                <option value="">Select payment method</option>
                {createLookups.paymentMethods.map((method) => (
                  <option key={method.name} value={method.name}>
                    {method.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Payment Status
              </label>
              <select
                required
                value={paymentStatus}
                onChange={(event) => {
                  paymentStatusEditedRef.current = true;
                  setPaymentStatus(event.target.value);
                }}
                className={expenseRegisterInputClassName}
              >
                {PAYMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Approved By
            </label>
            <select
              required
              value={approvedBy}
              onChange={(event) => setApprovedBy(event.target.value)}
              className={expenseRegisterInputClassName}
              disabled={lookupsLoading}
            >
              <option value="">Select approver</option>
              {createLookups.approvers.map((approver) => (
                <option key={approver.employee_id} value={approver.full_name}>
                  {approver.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || lookupsLoading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
