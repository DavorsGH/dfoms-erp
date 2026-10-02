"use client";

import { useMemo, useState } from "react";
import {
  legacySupplierIdOptionLabel,
  legacyVendorOptionLabel,
  SUPPLIER_SELECT_SEARCH_THRESHOLD,
  VENDOR_LEGACY_VALUE,
  VENDOR_OTHER_VALUE,
  type VendorSupplierOption,
} from "@/app/dashboard/finance/vendor-select-utils";

export const tenantSupplierSelectInputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type SupplierSelectListProps = {
  suppliers: VendorSupplierOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  legacyOption?: { value: string; label: string } | null;
  showOneTimeOther?: boolean;
  className?: string;
};

function SupplierSelectList({
  suppliers,
  value,
  onChange,
  required,
  disabled,
  allowEmpty = false,
  emptyLabel = "Select supplier",
  legacyOption,
  showOneTimeOther = false,
  className = tenantSupplierSelectInputClassName,
}: SupplierSelectListProps) {
  const [filter, setFilter] = useState("");
  const searchable = suppliers.length >= SUPPLIER_SELECT_SEARCH_THRESHOLD;

  const filteredSuppliers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return suppliers;
    }
    return suppliers.filter((supplier) =>
      supplier.name.toLowerCase().includes(query),
    );
  }, [filter, suppliers]);

  return (
    <>
      {searchable ? (
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search suppliers…"
          className={`${className} mb-2`}
          disabled={disabled}
          aria-label="Search suppliers"
        />
      ) : null}
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        disabled={disabled}
      >
        <option value="">{emptyLabel}</option>
        {legacyOption ? (
          <option value={legacyOption.value}>{legacyOption.label}</option>
        ) : null}
        {filteredSuppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
        {showOneTimeOther ? (
          <option value={VENDOR_OTHER_VALUE}>Other (one-time supplier)</option>
        ) : null}
      </select>
    </>
  );
}

/** Stores supplier **name** (expense register, AP, fixed assets, raw material purchases). */
export function TenantSupplierVendorNameFields({
  label = "Supplier",
  vendorSelect,
  vendorOther,
  onVendorSelectChange,
  onVendorOtherChange,
  suppliers,
  disabled,
  required = true,
  showOneTimeOther = true,
  className = tenantSupplierSelectInputClassName,
}: {
  label?: string;
  vendorSelect: string;
  vendorOther: string;
  onVendorSelectChange: (value: string) => void;
  onVendorOtherChange: (value: string) => void;
  suppliers: VendorSupplierOption[];
  disabled?: boolean;
  required?: boolean;
  showOneTimeOther?: boolean;
  className?: string;
}) {
  const legacyOption =
    vendorSelect === VENDOR_LEGACY_VALUE
      ? {
          value: VENDOR_LEGACY_VALUE,
          label: legacyVendorOptionLabel(vendorOther),
        }
      : null;

  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {label}
        </label>
        <SupplierSelectList
          suppliers={suppliers}
          value={vendorSelect}
          onChange={onVendorSelectChange}
          required={required}
          disabled={disabled}
          allowEmpty={!required}
          emptyLabel="Select supplier"
          legacyOption={legacyOption}
          showOneTimeOther={showOneTimeOther}
          className={className}
        />
      </div>
      {showOneTimeOther && vendorSelect === VENDOR_OTHER_VALUE ? (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            One-time supplier name
          </label>
          <input
            type="text"
            required={required}
            value={vendorOther}
            onChange={(event) => onVendorOtherChange(event.target.value)}
            className={className}
            disabled={disabled}
          />
        </div>
      ) : null}
    </>
  );
}

/** Stores supplier **id** (product purchases, POs, finished product default supplier). */
export function TenantSupplierIdSelect({
  label = "Supplier",
  value,
  onChange,
  suppliers,
  disabled,
  required = false,
  allowEmpty = true,
  emptyLabel = "Select supplier",
  legacyDisplayName,
  className = tenantSupplierSelectInputClassName,
}: {
  label?: string;
  value: string;
  onChange: (supplierId: string) => void;
  suppliers: VendorSupplierOption[];
  disabled?: boolean;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** When value is set but not in `suppliers`, show this label on the legacy option. */
  legacyDisplayName?: string | null;
  className?: string;
}) {
  const inList = value ? suppliers.some((supplier) => supplier.id === value) : true;
  const legacyOption =
    value && !inList
      ? {
          value,
          label: legacySupplierIdOptionLabel(legacyDisplayName),
        }
      : null;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <SupplierSelectList
        suppliers={suppliers}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        legacyOption={legacyOption}
        showOneTimeOther={false}
        className={className}
      />
    </div>
  );
}
