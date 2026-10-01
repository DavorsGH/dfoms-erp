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
import { createGraPenaltyViaAccountsPayable } from "./gra-penalty-via-accounts-payable";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import type { GraReconciliationKind } from "./statutory-due-rules";
import {
  resolveGraPenaltyDialogDefaults,
  type GraPenaltyRecordingMode,
} from "./gra-penalty-dialog-defaults";
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
  onSaved: (
    expenseId: string,
    expenseDate: string,
    amount: number,
    accountsPayableId?: string | null,
  ) => void;
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
  const [approvedBy, setApprovedBy] = useState("");
  const [penaltyPaymentChoice, setPenaltyPaymentChoice] =
    useState<GraPenaltyRecordingMode>(() =>
      hasRemittedLedgerActivity ? "paid" : "unpaid",
    );
  const [dateDefaultNote, setDateDefaultNote] = useState<string | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [vendorDefaultsApplied, setVendorDefaultsApplied] = useState(false);
  const dateEditedRef = useRef(false);
  const paymentMethodEditedRef = useRef(false);
  const [similarExpense, setSimilarExpense] =
    useState<SimilarPenaltyExpense | null>(null);
  const [recordAnyway, setRecordAnyway] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const recordViaAccountsPayable = penaltyPaymentChoice === "unpaid";

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
        recordingMode: penaltyPaymentChoice,
      });

      if (cancelled) {
        return;
      }

      if (!dateEditedRef.current) {
        setDate(resolved.date);
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
    penaltyPaymentChoice,
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

    setSubmitting(true);

    if (recordViaAccountsPayable) {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace.");
        setSubmitting(false);
        return;
      }

      const apResult = await createGraPenaltyViaAccountsPayable({
        supabase,
        tenantId,
        businessUnitId,
        kind,
        periodMonth,
        invoiceDate: date,
        vendorName,
        expenseCategory,
        subCategory,
        description,
        penaltyAmount,
      });

      if (!apResult.ok) {
        setError(apResult.error);
        setSubmitting(false);
        return;
      }

      onSaved(apResult.expenseId, date, penaltyAmount, apResult.apId);
      onClose();
      return;
    }

    if (!paymentMethod.trim()) {
      setError("Payment method is required.");
      setSubmitting(false);
      return;
    }

    if (!approvedBy.trim()) {
      setError("Approved by is required.");
      setSubmitting(false);
      return;
    }

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
      payment_status: "Paid",
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

    onSaved(result.expenseId, date, penaltyAmount, null);
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
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-slate-700">
              Has this penalty been paid?
            </legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="gra-penalty-paid"
                  required
                  checked={penaltyPaymentChoice === "paid"}
                  onChange={() => setPenaltyPaymentChoice("paid")}
                  disabled={defaultsLoading}
                />
                Yes, paid
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="gra-penalty-paid"
                  checked={penaltyPaymentChoice === "unpaid"}
                  onChange={() => setPenaltyPaymentChoice("unpaid")}
                  disabled={defaultsLoading}
                />
                Not yet
              </label>
            </div>
          </fieldset>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {recordViaAccountsPayable ? "Invoice date" : "Date"}
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
          {recordViaAccountsPayable ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium text-slate-800">Record as payable</p>
              <p className="mt-1 text-slate-600">
                Pay it later from Finance → Accounts Payable → Record Payment.
              </p>
            </div>
          ) : (
            <>
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
                    <option
                      key={approver.employee_id}
                      value={approver.full_name}
                    >
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
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
              {submitting
                ? "Saving…"
                : recordViaAccountsPayable
                  ? "Save as payable"
                  : "Save expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
