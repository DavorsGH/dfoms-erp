export const PURCHASE_ORDER_STATUSES = ["draft", "sent", "received"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_ITEM_TYPES = [
  "raw_material",
  "finished_product",
] as const;
export type PurchaseOrderItemType = (typeof PURCHASE_ORDER_ITEM_TYPES)[number];

export const PURCHASE_ORDER_LIST_SELECT =
  "id, po_number, supplier_id, status, order_date, expected_date, notes, created_at, tenant_id, supplier:suppliers!supplier_id(name), items:purchase_order_items(quantity_ordered, unit_cost)" as const;

export const PURCHASE_ORDER_DETAIL_SELECT =
  "id, po_number, supplier_id, status, order_date, expected_date, notes, created_at, updated_at, tenant_id, supplier:suppliers!supplier_id(name), items:purchase_order_items(id, item_type, raw_material_id, finished_product_id, quantity_ordered, quantity_received, unit_cost, raw_material:raw_materials!raw_material_id(material_code, material_name, unit_of_measure), finished_product:finished_products!finished_product_id(product_code, product_name, unit_of_measure))" as const;

export const PO_RAW_MATERIAL_OPTION_SELECT =
  "id, material_code, material_name, unit_of_measure" as const;

export const PO_FINISHED_PRODUCT_OPTION_SELECT =
  "id, product_code, product_name, unit_of_measure" as const;

export type PurchaseOrderSupplier = {
  name: string;
};

export type PurchaseOrderRawMaterialOption = {
  id: string;
  material_code: string;
  material_name: string;
  unit_of_measure: string;
};

export type PurchaseOrderFinishedProductOption = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
};

type ListItemTotals = {
  quantity_ordered: number;
  unit_cost: number;
};

export type PurchaseOrderListRow = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  tenant_id: string;
  supplier?: PurchaseOrderSupplier | PurchaseOrderSupplier[] | null;
  items?: ListItemTotals[] | null;
};

export type PurchaseOrderItemMaterialRef = {
  material_code: string;
  material_name: string;
  unit_of_measure: string;
};

export type PurchaseOrderItemProductRef = {
  product_code: string;
  product_name: string;
  unit_of_measure: string;
};

export type PurchaseOrderItemRow = {
  id: string;
  item_type: PurchaseOrderItemType;
  raw_material_id: string | null;
  finished_product_id: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  raw_material?: PurchaseOrderItemMaterialRef | PurchaseOrderItemMaterialRef[] | null;
  finished_product?: PurchaseOrderItemProductRef | PurchaseOrderItemProductRef[] | null;
};

export type PurchaseOrderDetailRow = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  supplier?: PurchaseOrderSupplier | PurchaseOrderSupplier[] | null;
  items?: PurchaseOrderItemRow[] | null;
};

export type PurchaseOrderItemInput = {
  item_type?: string;
  raw_material_id?: string | null;
  finished_product_id?: string | null;
  quantity_ordered?: number | string;
  unit_cost?: number | string;
};

export type PurchaseOrderWriteBody = {
  supplier_id?: string;
  order_date?: string;
  expected_date?: string | null;
  notes?: string | null;
  items?: PurchaseOrderItemInput[];
};

export type PurchaseOrderDeletePreview = {
  can_delete: boolean;
  received_line_count: number;
};

export type PurchaseOrderDeleteConfirmBody = {
  confirmed?: boolean;
};

function parseRpcBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "t";
}

export function normalizePurchaseOrderDeletePreview(
  raw: unknown,
): PurchaseOrderDeletePreview {
  const source = Array.isArray(raw) ? raw[0] : raw;
  const preview = (source ?? {}) as Record<string, unknown>;

  return {
    can_delete: parseRpcBoolean(preview.can_delete),
    received_line_count: Number(preview.received_line_count) || 0,
  };
}

export function buildPurchaseOrderDeleteBlockedMessage(
  preview: PurchaseOrderDeletePreview,
): string {
  const lineLabel = preview.received_line_count === 1 ? "line" : "lines";

  return `This purchase order has ${preview.received_line_count} ${lineLabel} with received purchases and can't be deleted.`;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function normalizePurchaseOrderStatus(value: unknown): PurchaseOrderStatus {
  if (value === "sent" || value === "received") {
    return value;
  }

  return "draft";
}

export function getPurchaseOrderSupplierName(
  supplier: PurchaseOrderSupplier | PurchaseOrderSupplier[] | null | undefined,
): string {
  return firstRelation(supplier)?.name?.trim() || "—";
}

export function calculatePurchaseOrderTotal(
  items: Array<{ quantity_ordered: number | string; unit_cost: number | string }>,
): number {
  const total = items.reduce((sum, item) => {
    const quantity = Number(item.quantity_ordered);
    const cost = Number(item.unit_cost);
    if (!Number.isFinite(quantity) || !Number.isFinite(cost)) {
      return sum;
    }

    return sum + quantity * cost;
  }, 0);

  return Math.round(total * 100) / 100;
}

export function normalizePurchaseOrderListRow(
  raw: PurchaseOrderListRow,
): PurchaseOrderListRow & { total: number } {
  const items = (raw.items ?? []).map((item) => ({
    quantity_ordered: Number(item.quantity_ordered) || 0,
    unit_cost: Number(item.unit_cost) || 0,
  }));

  return {
    ...raw,
    status: normalizePurchaseOrderStatus(raw.status),
    supplier: firstRelation(raw.supplier),
    items,
    total: calculatePurchaseOrderTotal(items),
  };
}

export type NormalizedPurchaseOrderListRow = ReturnType<
  typeof normalizePurchaseOrderListRow
>;

export function getPurchaseOrderItemLabel(item: PurchaseOrderItemRow): string {
  if (item.item_type === "raw_material") {
    const material = firstRelation(item.raw_material);
    return material
      ? `${material.material_code} — ${material.material_name}`
      : "—";
  }

  const product = firstRelation(item.finished_product);
  return product ? `${product.product_code} — ${product.product_name}` : "—";
}

export function getPurchaseOrderItemUnit(item: PurchaseOrderItemRow): string {
  if (item.item_type === "raw_material") {
    return firstRelation(item.raw_material)?.unit_of_measure ?? "";
  }

  return firstRelation(item.finished_product)?.unit_of_measure ?? "";
}

export function normalizePurchaseOrderDetail(
  raw: PurchaseOrderDetailRow,
): PurchaseOrderDetailRow & { total: number } {
  const items = (raw.items ?? []).map((item) => ({
    ...item,
    quantity_ordered: Number(item.quantity_ordered) || 0,
    quantity_received: Number(item.quantity_received) || 0,
    unit_cost: Number(item.unit_cost) || 0,
  }));

  return {
    ...raw,
    status: normalizePurchaseOrderStatus(raw.status),
    supplier: firstRelation(raw.supplier),
    items,
    total: calculatePurchaseOrderTotal(items),
  };
}

export function formatPurchaseOrderStatus(status: PurchaseOrderStatus): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "received":
      return "Received";
    default:
      return "Draft";
  }
}

export function getPurchaseOrderStatusBadgeClassName(
  status: PurchaseOrderStatus,
): string {
  const base = "inline-flex rounded-full px-2.5 py-1 text-xs font-medium";

  switch (status) {
    case "sent":
      return `${base} bg-blue-100 text-blue-800`;
    case "received":
      return `${base} bg-emerald-100 text-emerald-800`;
    default:
      return `${base} bg-slate-100 text-slate-700`;
  }
}

export function trimPurchaseOrderItems(items: PurchaseOrderItemInput[]) {
  return items.map((item) => {
    const itemType: PurchaseOrderItemType =
      item.item_type === "finished_product" ? "finished_product" : "raw_material";

    return {
      item_type: itemType,
      raw_material_id:
        itemType === "raw_material" ? (item.raw_material_id ?? "").trim() : null,
      finished_product_id:
        itemType === "finished_product"
          ? (item.finished_product_id ?? "").trim()
          : null,
      quantity_ordered: Number(item.quantity_ordered),
      unit_cost: Number(item.unit_cost),
    };
  });
}

export function trimPurchaseOrderInput(body: PurchaseOrderWriteBody) {
  return {
    supplier_id: (body.supplier_id ?? "").trim(),
    order_date: (body.order_date ?? "").trim(),
    expected_date: (body.expected_date ?? "").trim() || null,
    notes: (body.notes ?? "").trim() || null,
    items: trimPurchaseOrderItems(body.items ?? []),
  };
}

export function validatePurchaseOrderBody(
  body: PurchaseOrderWriteBody,
): string | null {
  const trimmed = trimPurchaseOrderInput(body);

  if (!trimmed.supplier_id) {
    return "Select a supplier.";
  }

  if (!trimmed.order_date) {
    return "Order date is required.";
  }

  if (trimmed.items.length === 0) {
    return "Add at least one line item.";
  }

  for (const [index, item] of trimmed.items.entries()) {
    const lineNumber = index + 1;

    if (item.item_type === "raw_material" && !item.raw_material_id) {
      return `Line ${lineNumber}: select a raw material.`;
    }

    if (item.item_type === "finished_product" && !item.finished_product_id) {
      return `Line ${lineNumber}: select a finished product.`;
    }

    if (!Number.isFinite(item.quantity_ordered) || item.quantity_ordered <= 0) {
      return `Line ${lineNumber}: quantity ordered must be greater than zero.`;
    }

    if (!Number.isFinite(item.unit_cost) || item.unit_cost < 0) {
      return `Line ${lineNumber}: unit cost must be zero or greater.`;
    }
  }

  return null;
}
