export const VENDOR_OTHER_VALUE = "__other__";
/** Saved vendor name that does not match any tenant supplier (read-only in the list). */
export const VENDOR_LEGACY_VALUE = "__legacy__";

export const SUPPLIER_SELECT_SEARCH_THRESHOLD = 15;

export type VendorSupplierOption = {
  id: string;
  name: string;
};

export function supplierNamesMatch(a: string, b: string): boolean {
  return (
    a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0
  );
}

export function legacyVendorOptionLabel(storedName: string): string {
  const trimmed = storedName.trim();
  return trimmed
    ? `${trimmed} (not in supplier list)`
    : "Unknown supplier (not in supplier list)";
}

export function legacySupplierIdOptionLabel(displayName: string | null | undefined): string {
  const trimmed = displayName?.trim();
  return trimmed
    ? `${trimmed} (not in supplier list)`
    : "Supplier not in list";
}

export function resolveVendorNameFromSelect(
  vendorSelect: string,
  vendorOther: string,
  suppliers: VendorSupplierOption[],
): string {
  if (
    vendorSelect === VENDOR_OTHER_VALUE ||
    vendorSelect === VENDOR_LEGACY_VALUE
  ) {
    return vendorOther.trim();
  }
  const match = suppliers.find((supplier) => supplier.id === vendorSelect);
  return match?.name ?? "";
}

export function inferVendorSelectState(
  storedVendorName: string,
  suppliers: VendorSupplierOption[],
): { vendorSelect: string; vendorOther: string } {
  const trimmed = storedVendorName.trim();
  if (!trimmed) {
    return { vendorSelect: "", vendorOther: "" };
  }

  const match = suppliers.find((supplier) =>
    supplierNamesMatch(supplier.name, trimmed),
  );
  if (match) {
    return { vendorSelect: match.id, vendorOther: "" };
  }

  return { vendorSelect: VENDOR_LEGACY_VALUE, vendorOther: trimmed };
}

export function mergeSupplierOptions(
  primary: VendorSupplierOption[],
  extra: VendorSupplierOption[],
): VendorSupplierOption[] {
  if (extra.length === 0) {
    return primary;
  }
  const seen = new Set(primary.map((row) => row.id));
  const merged = [...primary];
  for (const row of extra) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "accent" }),
  );
}

export function inferSupplierIdSelectState(
  storedSupplierId: string,
  storedDisplayName: string | null | undefined,
  suppliers: VendorSupplierOption[],
): { selectValue: string; legacy: boolean } {
  const id = storedSupplierId.trim();
  if (!id) {
    return { selectValue: "", legacy: false };
  }
  if (suppliers.some((supplier) => supplier.id === id)) {
    return { selectValue: id, legacy: false };
  }
  return { selectValue: id, legacy: true };
}
