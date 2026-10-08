import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import { creditNoteAvailableBalance } from "../finance/credit-notes-utils";
import { mergePosCartLines, roundMoney, type PosCartLine } from "./pos-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";

export const STORE_CREDIT_MOMO_BLOCK_MESSAGE =
  "Store credit cannot be combined with Mobile Money checkout yet. Use Cash or Bank transfer for the remainder, or pay the full balance with Mobile Money without store credit.";

export const STORE_CREDIT_OFFLINE_BLOCK_MESSAGE =
  "Store credit checkout requires an online connection. Complete the sale when you are back online.";

export type PosSelectedStoreCredit = {
  id: string;
  creditNoteNumber: string;
  clientId: string | null;
  availableBalance: number;
  returnMode: string | null;
};

export type PosStoreCreditUrlOptions = {
  creditNoteId: string;
  loadLines?: boolean;
};

export function buildPosStoreCreditCheckoutUrl(
  options: PosStoreCreditUrlOptions,
): string {
  const params = new URLSearchParams();
  params.set("creditNoteId", options.creditNoteId);
  if (options.loadLines) {
    params.set("loadLines", "1");
  }
  return `/dashboard/pos?${params.toString()}`;
}

export function parsePosStoreCreditLoadLinesParam(
  value: string | null | undefined,
): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export type PosStoreCreditUrlParams = {
  creditNoteId: string;
  loadLines: boolean;
};

export function readPosStoreCreditUrlParams(
  search: string,
): PosStoreCreditUrlParams {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const creditNoteId = params.get("creditNoteId")?.trim() ?? "";
  return {
    creditNoteId,
    loadLines:
      creditNoteId.length > 0 &&
      parsePosStoreCreditLoadLinesParam(params.get("loadLines")),
  };
}

export function creditNoteVisibleInBusinessUnitReadScope(
  noteBusinessUnitId: string | null | undefined,
  scope: BusinessUnitReadScope,
): boolean {
  const noteBu = noteBusinessUnitId?.trim() || null;
  if (scope.mode === "all") {
    return true;
  }
  if (scope.mode === "unit") {
    return noteBu === scope.id;
  }
  return noteBu === null;
}

export type ResolveCreditNoteForPosResult =
  | { ok: true; note: PosSelectedStoreCredit }
  | { ok: false; message: string };

type CreditNoteRowForPos = {
  id: string;
  credit_note_number: string | null;
  client_id: string | null;
  total_amount: number | null;
  refunded_amount: number | null;
  applied_amount: number | null;
  return_mode: string | null;
  status: string | null;
  business_unit_id: string | null;
};

function creditNoteAvailableFromRow(row: CreditNoteRowForPos): number {
  return creditNoteAvailableBalance({
    total_amount: Number(row.total_amount) || 0,
    refunded_amount: Number(row.refunded_amount) || 0,
    applied_amount: Number(row.applied_amount) || 0,
  });
}

function mapCreditNoteRowToPosSelection(
  row: CreditNoteRowForPos,
): PosSelectedStoreCredit {
  const available = creditNoteAvailableFromRow(row);
  return {
    id: String(row.id),
    creditNoteNumber: String(row.credit_note_number ?? ""),
    clientId: row.client_id ? String(row.client_id) : null,
    availableBalance: available,
    returnMode: row.return_mode ? String(row.return_mode) : null,
  };
}

export async function resolveCreditNoteForPosCheckout(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  creditNoteId: string,
): Promise<ResolveCreditNoteForPosResult> {
  const id = creditNoteId.trim();
  if (!id) {
    return { ok: false, message: "Credit note id is missing from the link." };
  }

  const { data, error } = await supabase
    .from("credit_notes")
    .select(
      "id, credit_note_number, client_id, total_amount, refunded_amount, applied_amount, return_mode, status, business_unit_id",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      ok: false,
      message: "Credit note not found in this workspace.",
    };
  }

  const row = data as CreditNoteRowForPos;

  if (!creditNoteVisibleInBusinessUnitReadScope(row.business_unit_id, buScope)) {
    return {
      ok: false,
      message:
        "This credit note belongs to another business unit. Switch to that business unit (or All Businesses) and open the link again.",
    };
  }

  const returnMode = String(row.return_mode ?? "").toLowerCase();
  if (
    returnMode !== "store_credit" &&
    returnMode !== "exchange_hold"
  ) {
    return {
      ok: false,
      message: "This credit note cannot be applied at checkout.",
    };
  }

  if (String(row.status ?? "").toLowerCase() === "voided") {
    return { ok: false, message: "This credit note is cancelled." };
  }

  const available = creditNoteAvailableFromRow(row);
  if (available <= 0) {
    return {
      ok: false,
      message: "This credit note has no available balance to apply.",
    };
  }

  return { ok: true, note: mapCreditNoteRowToPosSelection(row) };
}

export function posIncomePaymentMethodLabel(
  baseMethod: string,
  cashRecorded: number,
): string {
  const method = baseMethod.trim() || "Cash";
  if (cashRecorded <= 0.0001) {
    return "Store credit";
  }
  return `${method} + Store credit`;
}

export async function fetchAvailableCreditNotesForPos(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  clientId: string | null,
): Promise<PosSelectedStoreCredit[]> {
  let query = applyBusinessUnitScope(
    supabase
      .from("credit_notes")
      .select(
        "id, credit_note_number, client_id, total_amount, refunded_amount, applied_amount, return_mode, status",
      )
      .eq("tenant_id", tenantId)
      .in("return_mode", ["store_credit", "exchange_hold"]),
    buScope,
  ).order("credit_note_date", { ascending: false });

  const trimmedClient = clientId?.trim() || "";
  if (trimmedClient) {
    query = query.eq("client_id", trimmedClient);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => {
      const available = creditNoteAvailableBalance(row);
      if (available <= 0) {
        return null;
      }
      if (String(row.status ?? "").toLowerCase() === "voided") {
        return null;
      }
      return {
        id: String(row.id),
        creditNoteNumber: String(row.credit_note_number ?? ""),
        clientId: row.client_id ? String(row.client_id) : null,
        availableBalance: available,
        returnMode: row.return_mode ? String(row.return_mode) : null,
      } satisfies PosSelectedStoreCredit;
    })
    .filter((row): row is PosSelectedStoreCredit => row !== null);
}

export async function lookupCreditNoteByNumberForPos(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  creditNoteNumber: string,
): Promise<PosSelectedStoreCredit | null> {
  const number = creditNoteNumber.trim();
  if (!number) {
    return null;
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("credit_notes")
      .select(
        "id, credit_note_number, client_id, total_amount, refunded_amount, applied_amount, return_mode, status",
      )
      .eq("tenant_id", tenantId)
      .eq("credit_note_number", number)
      .in("return_mode", ["store_credit", "exchange_hold"])
      .maybeSingle(),
    buScope,
  );

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  const available = creditNoteAvailableBalance(data);
  if (available <= 0 || String(data.status ?? "").toLowerCase() === "voided") {
    return null;
  }

  return {
    id: String(data.id),
    creditNoteNumber: String(data.credit_note_number ?? ""),
    clientId: data.client_id ? String(data.client_id) : null,
    availableBalance: available,
    returnMode: data.return_mode ? String(data.return_mode) : null,
  };
}

export async function fetchCreditNoteByIdForPos(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  creditNoteId: string,
): Promise<PosSelectedStoreCredit | null> {
  const result = await resolveCreditNoteForPosCheckout(
    supabase,
    tenantId,
    buScope,
    creditNoteId,
  );
  return result.ok ? result.note : null;
}

type CreditNoteLineRow = {
  product_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  product?: { product_code?: string; product_name?: string; unit_of_measure?: string } | Array<{
    product_code?: string;
    product_name?: string;
    unit_of_measure?: string;
  }> | null;
};

export async function fetchCreditNoteCartLines(
  supabase: SupabaseClient,
  creditNoteId: string,
  products: FinishedProductRecord[],
): Promise<PosCartLine[]> {
  const { data, error } = await supabase
    .from("credit_note_line_items")
    .select(
      "product_id, quantity, unit_price, product:finished_products(product_code, product_name, unit_of_measure)",
    )
    .eq("credit_note_id", creditNoteId);

  if (error) {
    throw new Error(error.message);
  }

  const lines: PosCartLine[] = [];
  for (const row of (data ?? []) as CreditNoteLineRow[]) {
    if (!row.product_id) {
      continue;
    }
    const product = products.find((entry) => entry.id === row.product_id);
    if (!product) {
      continue;
    }
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) {
      continue;
    }
    const unitPrice = roundMoney(
      Number(row.unit_price) || Number(product.standard_selling_price) || 0,
    );
    lines.push({
      id: crypto.randomUUID(),
      productId: product.id,
      productCode: product.product_code,
      productName: product.product_name,
      unitOfMeasure: product.unit_of_measure,
      quantity: qty,
      unitPrice,
      availableStock: product.current_stock ?? 0,
    });
  }
  return mergePosCartLines(lines);
}
