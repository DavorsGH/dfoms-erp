"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  CUSTOM_EXPENSE_CATEGORY_VALUE,
  EXPENSE_CATEGORY_OPTIONS,
  type ExpensePresetCategory,
} from "@/app/dashboard/real-estate/expenses-utils";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type PropertyOption = {
  propertyId: string;
  name: string;
};

type ExpenseFormProps = {
  properties: PropertyOption[];
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function LandlordPortalExpenseForm({
  properties,
}: ExpenseFormProps) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(
    properties[0]?.propertyId ?? "",
  );
  const [categoryMode, setCategoryMode] = useState<
    ExpensePresetCategory | typeof CUSTOM_EXPENSE_CATEGORY_VALUE
  >("repairs");
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function uploadReceipt(expenseId: string, file: File) {
    const formData = new FormData();
    formData.set("expense_id", expenseId);
    formData.set("file", file);

    const response = await fetch(
      "/api/landlord-portal/expenses/upload-receipt",
      {
        method: "POST",
        body: formData,
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      receipt_url?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false as const,
        error: payload?.error ?? "Unable to upload receipt.",
      };
    }

    return { ok: true as const, receiptUrl: payload?.receipt_url ?? null };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const category =
      categoryMode === CUSTOM_EXPENSE_CATEGORY_VALUE
        ? customCategory.trim()
        : categoryMode;

    const response = await fetch("/api/landlord-portal/expenses/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_id: propertyId,
        category,
        amount_ghs: amount,
        expense_date: expenseDate,
        description,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      expense_id?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save expense.");
      setLoading(false);
      return;
    }

    if (receiptFile && payload?.expense_id) {
      const uploadResult = await uploadReceipt(payload.expense_id, receiptFile);
      if (!uploadResult.ok) {
        setError(
          `Expense created, but receipt upload failed: ${uploadResult.error}`,
        );
        setAmount("");
        setDescription("");
        setReceiptFile(null);
        setLoading(false);
        router.refresh();
        return;
      }
    }

    setSuccess("Expense logged.");
    setAmount("");
    setDescription("");
    setReceiptFile(null);
    setLoading(false);
    router.refresh();
  }

  if (properties.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-600">
        Add a property before logging expenses.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="expense-property" className={portalLabelClassName}>
          Property
        </label>
        <select
          id="expense-property"
          className={portalInputClassName}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
          disabled={loading}
          required
        >
          {properties.map((property) => (
            <option key={property.propertyId} value={property.propertyId}>
              {property.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-category" className={portalLabelClassName}>
          Category
        </label>
        <select
          id="expense-category"
          className={portalInputClassName}
          value={categoryMode}
          onChange={(event) =>
            setCategoryMode(
              event.target.value as
                | ExpensePresetCategory
                | typeof CUSTOM_EXPENSE_CATEGORY_VALUE,
            )
          }
          disabled={loading}
        >
          {EXPENSE_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value={CUSTOM_EXPENSE_CATEGORY_VALUE}>Custom…</option>
        </select>
      </div>

      {categoryMode === CUSTOM_EXPENSE_CATEGORY_VALUE ? (
        <div>
          <label
            htmlFor="expense-custom-category"
            className={portalLabelClassName}
          >
            Custom category
          </label>
          <input
            id="expense-custom-category"
            className={portalInputClassName}
            value={customCategory}
            onChange={(event) => setCustomCategory(event.target.value)}
            disabled={loading}
            required
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="expense-amount" className={portalLabelClassName}>
            Amount (GHS)
          </label>
          <input
            id="expense-amount"
            type="number"
            min="0"
            step="0.01"
            className={portalInputClassName}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={loading}
            required
          />
        </div>
        <div>
          <label htmlFor="expense-date" className={portalLabelClassName}>
            Date
          </label>
          <input
            id="expense-date"
            type="date"
            className={portalInputClassName}
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
            disabled={loading}
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="expense-description" className={portalLabelClassName}>
          Description (optional)
        </label>
        <textarea
          id="expense-description"
          className={portalInputClassName}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={loading}
        />
      </div>

      <div>
        <p className={portalLabelClassName}>Receipt photo (optional)</p>
        <ImageFileUploadButton
          inputId="landlord-expense-receipt"
          files={receiptFile ? [receiptFile] : []}
          onChange={(next) => setReceiptFile(next[0] ?? null)}
          multiple={false}
          disabled={loading}
          addLabel="Add receipt"
          changeLabel="Change receipt"
        />
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <button
        type="submit"
        className={portalPrimaryButtonClassName}
        disabled={loading}
      >
        {loading ? "Saving…" : "Log expense"}
      </button>
    </form>
  );
}
