"use client";

import { useLayoutEffect, useMemo } from "react";
import type { NamedLookup } from "../lookup-types";
import { LOOKUP_HIDDEN_LABEL_SUFFIX } from "../administration/lookup-settings-shared";
import {
  expenseCategorySelectOptionsForCreate as filterExpenseCategoryRowsForSelect,
  expenseSubcategoryOptionsForCategory,
  expenseSubcategorySelectValueForOptions,
  type ExpenseCategoryLookupRow,
  type ExpenseSubcategoryLookup,
} from "./expense-register-utils";
import {
  isFixedAssetsExpenseCategory,
} from "@/utils/expense-register-category-guard";
import type { SupplierRow } from "@/utils/suppliers-types";
import type { VendorSupplierOption } from "./vendor-select-utils";
import { TenantSupplierVendorNameFields } from "@/components/tenant-supplier-select";

export const expenseRegisterInputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export function expenseCategorySelectOptionsForCreate(
  expenseCategories: Array<NamedLookup & { is_active?: boolean }>,
  editingExistingFixedAssets: boolean,
  currentCategory: string,
): ExpenseCategoryLookupRow[] {
  const isEditing = editingExistingFixedAssets;
  const keepFixedAssetsForEdit =
    isEditing && isFixedAssetsExpenseCategory(currentCategory);
  return filterExpenseCategoryRowsForSelect(
    expenseCategories,
    isEditing,
    currentCategory,
  ).filter((category) => {
    if (!isFixedAssetsExpenseCategory(category.name)) {
      return true;
    }
    return keepFixedAssetsForEdit;
  });
}

export function ExpenseRegisterSubCategorySelect({
  expenseCategory,
  value,
  onChange,
  allSubcategories,
  expenseCategories,
  disabled,
}: {
  expenseCategory: string;
  value: string;
  onChange: (next: string) => void;
  allSubcategories: ExpenseSubcategoryLookup[];
  expenseCategories?: ExpenseCategoryLookupRow[];
  disabled?: boolean;
}) {
  const options = useMemo(
    () =>
      expenseSubcategoryOptionsForCategory(
        expenseCategory,
        allSubcategories,
        value,
        expenseCategories,
      ),
    [allSubcategories, expenseCategories, expenseCategory, value],
  );

  const selectValue = useMemo(
    () => expenseSubcategorySelectValueForOptions(value, options),
    [options, value],
  );

  useLayoutEffect(() => {
    if (value !== selectValue) {
      onChange(selectValue);
    }
  }, [onChange, selectValue, value]);

  return (
    <select
      required
      value={selectValue}
      onChange={(event) => onChange(event.target.value)}
      className={expenseRegisterInputClassName}
      disabled={disabled || !expenseCategory.trim()}
    >
      <option value="">Select sub-category</option>
      {options.map((subcategory) => (
        <option key={subcategory.name} value={subcategory.name}>
          {subcategory.isHidden
            ? `${subcategory.name}${LOOKUP_HIDDEN_LABEL_SUFFIX}`
            : subcategory.name}
        </option>
      ))}
    </select>
  );
}

export function ExpenseRegisterSupplierFields({
  vendorSelect,
  vendorOther,
  onVendorSelectChange,
  onVendorOtherChange,
  suppliers,
  disabled,
}: {
  vendorSelect: string;
  vendorOther: string;
  onVendorSelectChange: (value: string) => void;
  onVendorOtherChange: (value: string) => void;
  suppliers: VendorSupplierOption[];
  disabled?: boolean;
}) {
  return (
    <TenantSupplierVendorNameFields
      vendorSelect={vendorSelect}
      vendorOther={vendorOther}
      onVendorSelectChange={onVendorSelectChange}
      onVendorOtherChange={onVendorOtherChange}
      suppliers={suppliers}
      disabled={disabled}
      className={expenseRegisterInputClassName}
    />
  );
}

export function ExpenseRegisterReceiptNoField({
  value,
  onChange,
  isCreate,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  isCreate: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Receipt No.
      </label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          isCreate
            ? "Leave blank to auto-assign, or enter supplier receipt #"
            : undefined
        }
        className={expenseRegisterInputClassName}
        disabled={disabled}
      />
      {isCreate ? (
        <p className="mt-1 text-xs text-slate-500">
          Leave blank for an internal code (e.g. DF-EXP-0001), or type the number
          printed on the supplier&apos;s paper receipt.
        </p>
      ) : null}
    </div>
  );
}

export function toVendorSupplierOptions(
  suppliers: SupplierRow[],
): VendorSupplierOption[] {
  return suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
  }));
}
