export const SUPPLIER_SELECT =
  "id, tenant_id, name, contact_person, phone, email, address, payment_terms_days, is_active, created_at, updated_at" as const;

export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export type SupplierRow = {
  id: string;
  tenant_id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupplierInput = {
  name?: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  payment_terms_days?: number | string | null;
  is_active?: boolean;
};

export function emptySupplierForm() {
  return {
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    payment_terms_days: String(DEFAULT_PAYMENT_TERMS_DAYS),
    is_active: true,
  };
}

export function supplierToForm(row: SupplierRow) {
  return {
    name: row.name,
    contact_person: row.contact_person ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    payment_terms_days: String(row.payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS),
    is_active: row.is_active,
  };
}

export function trimSupplierInput(input: SupplierInput) {
  const paymentTermsRaw = input.payment_terms_days;
  const paymentTermsDays =
    paymentTermsRaw == null || paymentTermsRaw === ""
      ? DEFAULT_PAYMENT_TERMS_DAYS
      : Number(paymentTermsRaw);

  return {
    name: (input.name ?? "").trim(),
    contact_person: (input.contact_person ?? "").trim() || null,
    phone: (input.phone ?? "").trim() || null,
    email: (input.email ?? "").trim() || null,
    address: (input.address ?? "").trim() || null,
    payment_terms_days: paymentTermsDays,
    is_active: input.is_active ?? true,
  };
}

export function validateSupplierInput(input: SupplierInput): string | null {
  const trimmed = trimSupplierInput(input);

  if (!trimmed.name) {
    return "Supplier name is required.";
  }

  if (
    !Number.isFinite(trimmed.payment_terms_days) ||
    trimmed.payment_terms_days < 0
  ) {
    return "Payment terms must be zero or a positive number of days.";
  }

  if (trimmed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
    return "Enter a valid email address or leave it blank.";
  }

  return null;
}

export function normalizeSupplier(row: SupplierRow): SupplierRow {
  return {
    ...row,
    contact_person: row.contact_person ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    payment_terms_days: Number(row.payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS),
    is_active: row.is_active ?? true,
  };
}

export function formatSupplierStatus(isActive: boolean): string {
  return isActive ? "Active" : "Inactive";
}

export type SupplierDeletePreview = {
  can_delete: boolean;
  purchase_count: number;
  purchase_order_count: number;
  supplier_name?: string;
};

export type SupplierDeleteConfirmBody = {
  confirmed?: boolean;
};

export function normalizeSupplierDeletePreview(raw: unknown): SupplierDeletePreview {
  let source: unknown = raw;

  if (Array.isArray(source)) {
    source = source[0];
  }

  if (typeof source === "string") {
    const match = source.match(/^\(?\s*([^,]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)?$/);
    if (match) {
      return {
        can_delete: parseSupplierDeleteBoolean(match[1]),
        purchase_count: Number(match[2]) || 0,
        purchase_order_count: Number(match[3]) || 0,
      };
    }
  }

  const preview = (source ?? {}) as Record<string, unknown>;

  return {
    can_delete: parseSupplierDeleteBoolean(preview.can_delete),
    purchase_count: Number(preview.purchase_count) || 0,
    purchase_order_count:
      Number(preview.po_count ?? preview.purchase_order_count) || 0,
    supplier_name:
      typeof preview.supplier_name === "string" ? preview.supplier_name : undefined,
  };
}

function parseSupplierDeleteBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "t";
}

export function buildSupplierDeleteBlockedMessage(
  preview: SupplierDeletePreview,
): string {
  const purchaseLabel =
    preview.purchase_count === 1 ? "purchase" : "purchases";
  const orderLabel =
    preview.purchase_order_count === 1 ? "purchase order" : "purchase orders";

  return `This supplier has ${preview.purchase_count} ${purchaseLabel} and ${preview.purchase_order_count} ${orderLabel} on record and can't be deleted. Use the Inactive toggle instead.`;
}

export const SUPPLIER_DELETE_CONFIRM_MESSAGE =
  "Delete this supplier? This cannot be undone.";
