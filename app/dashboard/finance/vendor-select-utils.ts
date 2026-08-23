export const VENDOR_OTHER_VALUE = "__other__";

export type VendorSupplierOption = {
  id: string;
  name: string;
};

export function resolveVendorNameFromSelect(
  vendorSelect: string,
  vendorOther: string,
  suppliers: VendorSupplierOption[],
): string {
  if (vendorSelect === VENDOR_OTHER_VALUE) {
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

  const match = suppliers.find(
    (supplier) =>
      supplier.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) ===
      0,
  );
  if (match) {
    return { vendorSelect: match.id, vendorOther: "" };
  }

  return { vendorSelect: VENDOR_OTHER_VALUE, vendorOther: trimmed };
}
