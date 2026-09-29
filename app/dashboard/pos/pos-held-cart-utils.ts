import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import {
  cartTotal,
  getAvailableStockForProduct,
  mergePosCartLines,
  roundMoney,
  type PosCartLine,
} from "./pos-utils";
import {
  resolveCreditNoteForPosCheckout,
  type PosSelectedStoreCredit,
} from "./pos-store-credit-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

export const POS_HELD_CART_OFFLINE_MESSAGE =
  "Holding a cart requires an online connection. Reconnect and try again.";

export const POS_HELD_CART_OLD_DAYS = 7;

export type PosHeldCartSnapshot = {
  version: 1;
  lines: Array<{
    productId: string;
    productCode: string;
    productName: string;
    unitOfMeasure: string;
    quantity: number;
    unitPrice: number;
  }>;
  promoCode: string | null;
  promoDiscount: number;
  storeCreditNoteId: string | null;
  customerName: string | null;
};

export type PosHeldCartRow = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  label: string;
  client_id: string | null;
  cart: PosHeldCartSnapshot;
  sales_rep_id: string | null;
  notes: string | null;
  held_by: string;
  held_at: string;
  updated_at: string;
  heldByLabel?: string;
};

export type PosRecallLineWarning = {
  productCode: string;
  productName: string;
  heldUnitPrice: number;
  currentUnitPrice: number;
  heldQuantity: number;
  maxAvailable: number;
  priceChanged: boolean;
  insufficientStock: boolean;
};

export type PosRecallValidation = {
  lines: PosCartLine[];
  warnings: PosRecallLineWarning[];
  promoCode: string | null;
  promoDiscount: number;
  storeCreditNoteId: string | null;
  clientId: string | null;
  customerName: string | null;
  salesRepId: string | null;
  notes: string | null;
};

function defaultLabel(): string {
  return `Hold ${new Date().toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  })}`;
}

export function isPosHeldCartOld(heldAt: string, now = Date.now()): boolean {
  const heldMs = Date.parse(heldAt);
  if (!Number.isFinite(heldMs)) {
    return false;
  }
  return now - heldMs > POS_HELD_CART_OLD_DAYS * 24 * 60 * 60 * 1000;
}

export function buildHeldCartSnapshot(input: {
  cartLines: PosCartLine[];
  appliedPromoCode: string | null;
  promoDiscount: number;
  selectedStoreCreditId: string | null;
  customerName: string;
}): PosHeldCartSnapshot {
  return {
    version: 1,
    lines: input.cartLines.map((line) => ({
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    promoCode: input.appliedPromoCode,
    promoDiscount: roundMoney(Math.max(0, input.promoDiscount)),
    storeCreditNoteId: input.selectedStoreCreditId,
    customerName: input.customerName.trim() || null,
  };
}

function parseHeldCartSnapshot(raw: unknown): PosHeldCartSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const cart = raw as PosHeldCartSnapshot;
  if (cart.version !== 1 || !Array.isArray(cart.lines)) {
    return null;
  }
  return cart;
}

export function heldCartItemCount(row: PosHeldCartRow): number {
  return row.cart.lines.length;
}

export function heldCartTotal(row: PosHeldCartRow): number {
  const gross = roundMoney(
    row.cart.lines.reduce(
      (sum, line) => sum + roundMoney(line.quantity * line.unitPrice),
      0,
    ),
  );
  const discount = roundMoney(Math.max(0, row.cart.promoDiscount ?? 0));
  return roundMoney(Math.max(0, gross - discount));
}

async function resolveHeldByLabels(
  supabase: SupabaseClient,
  authUids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(authUids.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("user_accounts")
    .select("auth_uid, email, employees!user_accounts_employee_id_fkey(full_name)")
    .in("auth_uid", unique);

  if (error) {
    return map;
  }

  for (const row of data ?? []) {
    const uid = String(row.auth_uid ?? "");
    const employee = row.employees as { full_name?: string | null } | null;
    const name = employee?.full_name?.trim();
    const label = name || String(row.email ?? uid);
    if (uid) {
      map.set(uid, label);
    }
  }
  return map;
}

export async function fetchPosHeldCarts(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PosHeldCartRow[]> {
  const { data, error } = await supabase
    .from("pos_held_carts")
    .select(
      "id, tenant_id, business_unit_id, label, client_id, cart, sales_rep_id, notes, held_by, held_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("held_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows: PosHeldCartRow[] = [];
  for (const raw of data ?? []) {
    const snapshot = parseHeldCartSnapshot(raw.cart);
    if (!snapshot) {
      continue;
    }
    rows.push({
      id: String(raw.id),
      tenant_id: String(raw.tenant_id),
      business_unit_id: raw.business_unit_id ? String(raw.business_unit_id) : null,
      label: String(raw.label ?? ""),
      client_id: raw.client_id ? String(raw.client_id) : null,
      cart: snapshot,
      sales_rep_id: raw.sales_rep_id ? String(raw.sales_rep_id) : null,
      notes: raw.notes ? String(raw.notes) : null,
      held_by: String(raw.held_by),
      held_at: String(raw.held_at),
      updated_at: String(raw.updated_at),
    });
  }

  const labels = await resolveHeldByLabels(
    supabase,
    rows.map((row) => row.held_by),
  );
  return rows.map((row) => ({
    ...row,
    heldByLabel: labels.get(row.held_by) ?? row.held_by.slice(0, 8),
  }));
}

export async function insertPosHeldCart(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    businessUnitId: string | null;
    label: string;
    clientId: string | null;
    cart: PosHeldCartSnapshot;
    salesRepId: string | null;
    notes: string | null;
    heldBy: string;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("pos_held_carts")
    .insert({
      tenant_id: input.tenantId,
      business_unit_id: input.businessUnitId,
      label: input.label.trim() || defaultLabel(),
      client_id: input.clientId,
      cart: input.cart,
      sales_rep_id: input.salesRepId,
      notes: input.notes,
      held_by: input.heldBy,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return String(data.id);
}

export async function deletePosHeldCart(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("pos_held_carts").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

export function validatePosHeldCartRecall(
  row: PosHeldCartRow,
  products: FinishedProductRecord[],
): PosRecallValidation {
  const warnings: PosRecallLineWarning[] = [];
  const lines: PosCartLine[] = [];

  for (const heldLine of row.cart.lines) {
    const product = products.find((item) => item.id === heldLine.productId);
    const currentUnitPrice = roundMoney(
      product?.standard_selling_price ?? heldLine.unitPrice,
    );
    const priceChanged =
      Math.abs(currentUnitPrice - roundMoney(heldLine.unitPrice)) > 0.0001;

    let maxAvailable = 0;
    if (product) {
      maxAvailable = getAvailableStockForProduct(product, lines);
    }

    const insufficientStock = !product || heldLine.quantity > maxAvailable;

    if (priceChanged || insufficientStock) {
      warnings.push({
        productCode: heldLine.productCode,
        productName: heldLine.productName,
        heldUnitPrice: heldLine.unitPrice,
        currentUnitPrice,
        heldQuantity: heldLine.quantity,
        maxAvailable,
        priceChanged,
        insufficientStock,
      });
    }

    lines.push({
      id: crypto.randomUUID(),
      productId: heldLine.productId,
      productCode: heldLine.productCode,
      productName: heldLine.productName,
      unitOfMeasure: heldLine.unitOfMeasure,
      quantity: heldLine.quantity,
      unitPrice: priceChanged ? currentUnitPrice : heldLine.unitPrice,
      availableStock: maxAvailable,
    });
  }

  return {
    lines: mergePosCartLines(lines),
    warnings,
    promoCode: row.cart.promoCode,
    promoDiscount: row.cart.promoDiscount ?? 0,
    storeCreditNoteId: row.cart.storeCreditNoteId,
    clientId: row.client_id,
    customerName: row.cart.customerName,
    salesRepId: row.sales_rep_id,
    notes: row.notes,
  };
}

export async function revalidateRecalledStoreCredit(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  storeCreditNoteId: string | null,
): Promise<
  | { ok: true; note: PosSelectedStoreCredit | null }
  | { ok: false; message: string }
> {
  if (!storeCreditNoteId?.trim()) {
    return { ok: true, note: null };
  }

  const result = await resolveCreditNoteForPosCheckout(
    supabase,
    tenantId,
    buScope,
    storeCreditNoteId,
  );
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, note: result.note };
}

export function recallCartGrossTotal(lines: PosCartLine[]): number {
  return cartTotal(lines);
}
