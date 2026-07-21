export const PRODUCT_PURCHASE_LIST_SELECT =
  "id, product_id, purchase_date, quantity, cost_per_unit, total_cost, supplier_id, payment_method, notes, created_at, tenant_id, product:finished_products!product_id(product_code, product_name, unit_of_measure), supplier:suppliers!supplier_id(name)" as const;

export const PURCHASED_PRODUCT_SELECT =
  "id, product_code, product_name, unit_of_measure, sourcing_type" as const;

export type PurchasedProductOption = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  sourcing_type: string | null;
};

export type ProductPurchaseProduct = {
  product_code: string;
  product_name: string;
  unit_of_measure: string;
};

export type ProductPurchaseSupplier = {
  name: string;
};

export type ProductPurchaseListRow = {
  id: string;
  product_id: string;
  purchase_date: string;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  supplier_id: string | null;
  payment_method: string;
  notes: string | null;
  created_at: string;
  tenant_id: string;
  product?: ProductPurchaseProduct | null;
  supplier?: ProductPurchaseSupplier | null;
};

export type ProductPurchaseWriteBody = {
  product_id?: string;
  supplier_id?: string;
  purchase_date?: string;
  quantity?: number | string;
  cost_per_unit?: number | string;
  payment_method?: string;
  notes?: string | null;
};

export function emptyProductPurchaseForm() {
  return {
    product_id: "",
    supplier_id: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    quantity: "",
    cost_per_unit: "",
    payment_method: "",
    notes: "",
  };
}

export function normalizePurchasedProduct(
  raw: PurchasedProductOption,
): PurchasedProductOption {
  return {
    ...raw,
    sourcing_type: raw.sourcing_type ?? null,
  };
}

export function normalizeProductPurchaseRow(
  raw: ProductPurchaseListRow & {
    product?: ProductPurchaseProduct | ProductPurchaseProduct[] | null;
    supplier?: ProductPurchaseSupplier | ProductPurchaseSupplier[] | null;
  },
): ProductPurchaseListRow {
  const product = Array.isArray(raw.product)
    ? raw.product[0] ?? null
    : raw.product ?? null;
  const supplier = Array.isArray(raw.supplier)
    ? raw.supplier[0] ?? null
    : raw.supplier ?? null;

  return {
    ...raw,
    quantity: Number(raw.quantity) || 0,
    cost_per_unit: Number(raw.cost_per_unit) || 0,
    total_cost: Number(raw.total_cost) || 0,
    product,
    supplier,
  };
}

export function getProductPurchaseProductLabel(row: ProductPurchaseListRow): string {
  if (!row.product?.product_name) {
    return "—";
  }

  return `${row.product.product_code} — ${row.product.product_name}`;
}

export function getProductPurchaseSupplierLabel(row: ProductPurchaseListRow): string {
  return row.supplier?.name?.trim() || "—";
}

export function trimProductPurchaseInput(body: ProductPurchaseWriteBody) {
  return {
    product_id: (body.product_id ?? "").trim(),
    supplier_id: (body.supplier_id ?? "").trim(),
    purchase_date: (body.purchase_date ?? "").trim(),
    quantity: Number(body.quantity),
    cost_per_unit: Number(body.cost_per_unit),
    payment_method: (body.payment_method ?? "").trim(),
    notes: (body.notes ?? "").trim() || null,
  };
}

export function validateProductPurchaseBody(
  body: ProductPurchaseWriteBody,
): string | null {
  const trimmed = trimProductPurchaseInput(body);

  if (!trimmed.product_id) {
    return "Select a product.";
  }

  if (!trimmed.supplier_id) {
    return "Select a supplier.";
  }

  if (!trimmed.purchase_date) {
    return "Purchase date is required.";
  }

  if (!Number.isFinite(trimmed.quantity) || trimmed.quantity <= 0) {
    return "Quantity must be greater than zero.";
  }

  if (!Number.isFinite(trimmed.cost_per_unit) || trimmed.cost_per_unit < 0) {
    return "Cost per unit must be zero or greater.";
  }

  if (!trimmed.payment_method) {
    return "Select a payment method.";
  }

  return null;
}

export function calculateProductPurchaseTotal(
  quantity: number | string,
  costPerUnit: number | string,
): number {
  const qty = Number(quantity);
  const cost = Number(costPerUnit);

  if (!Number.isFinite(qty) || !Number.isFinite(cost)) {
    return 0;
  }

  return Math.round(qty * cost * 100) / 100;
}

export const PRODUCT_PURCHASE_DELETE_CONFIRM_MESSAGE =
  "Delete this purchase? This will reverse the stock increase and remove the linked payable entry. This cannot be undone.";
