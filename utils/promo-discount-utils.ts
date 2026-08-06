import type { SupabaseClient } from "@supabase/supabase-js";
import { roundMoney } from "@/utils/client-invoices-types";
import {
  type DiscountAppliesTo,
  type PromoCodePickerRow,
} from "@/utils/discount-rules-types";
import { parseRpcNumeric } from "@/utils/loyalty-types";

export type PromoSourceType = "product_sale" | "invoice";

export const PROMO_CODE_PICKER_SELECT =
  "code, name, applies_to, start_date, end_date, is_active" as const;

export type PromoCodeOption = {
  code: string;
  name: string;
  label: string;
};

export function formatPromoCodeOptionLabel(code: string, name: string) {
  return `${code} — ${name}`;
}

export function isPromoCodeRuleCurrentlyActive(
  rule: Pick<PromoCodePickerRow, "start_date" | "end_date" | "is_active">,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!rule.is_active) {
    return false;
  }

  const start = rule.start_date?.slice(0, 10) ?? null;
  const end = rule.end_date?.slice(0, 10) ?? null;
  if (start && start > today) {
    return false;
  }
  if (end && end < today) {
    return false;
  }

  return true;
}

export function promoCodeRuleAppliesToSource(
  appliesTo: DiscountAppliesTo,
  sourceType: PromoSourceType,
) {
  return appliesTo === "both" || appliesTo === sourceType;
}

export function filterPromoCodeOptions(
  rows: PromoCodePickerRow[],
  sourceType: PromoSourceType,
  today = new Date().toISOString().slice(0, 10),
): PromoCodeOption[] {
  return rows
    .filter((row) => isPromoCodeRuleCurrentlyActive(row, today))
    .filter((row) => promoCodeRuleAppliesToSource(row.applies_to, sourceType))
    .map((row) => ({
      code: row.code,
      name: row.name,
      label: formatPromoCodeOptionLabel(row.code, row.name),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export async function fetchActivePromoCodeOptions(
  supabase: SupabaseClient,
  sourceType: PromoSourceType,
): Promise<{ options: PromoCodeOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from("discount_rules")
    .select(PROMO_CODE_PICKER_SELECT)
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    return { options: [], error: error.message };
  }

  return {
    options: filterPromoCodeOptions((data as PromoCodePickerRow[] | null) ?? [], sourceType),
    error: null,
  };
}

export type ApplyPromoDiscountInput = {
  code: string;
  clientId: string | null;
  orderAmount: number;
  sourceType: PromoSourceType;
  sourceReference?: string | null;
};

export type ApplyPromoDiscountResult =
  | { ok: true; discountAmount: number }
  | { ok: false; error: string };

export async function applyPromoDiscount(
  supabase: SupabaseClient,
  input: ApplyPromoDiscountInput,
): Promise<ApplyPromoDiscountResult> {
  const trimmedCode = input.code.trim();
  if (!trimmedCode) {
    return { ok: false, error: "Enter a promo code." };
  }

  if (input.orderAmount <= 0) {
    return { ok: false, error: "Order amount must be greater than zero." };
  }

  const { data, error } = await supabase.rpc("validate_and_apply_discount", {
    p_code: trimmedCode,
    p_client_id: input.clientId,
    p_order_amount: roundMoney(input.orderAmount),
    p_source_type: input.sourceType,
    p_source_reference: input.sourceReference?.trim() || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const discountAmount = parseRpcNumeric(data);
  if (discountAmount <= 0) {
    return { ok: false, error: "This promo code did not apply a discount." };
  }

  return { ok: true, discountAmount };
}

export async function redeemLoyaltyPointsForCheckout(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    points: number;
    sourceType: PromoSourceType;
    sourceReference?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: true; discountAmount: number } | { ok: false; error: string }> {
  if (input.points <= 0) {
    return { ok: false, error: "Enter points to redeem." };
  }

  const { data, error } = await supabase.rpc("redeem_loyalty_points", {
    p_client_id: input.clientId,
    p_points: input.points,
    p_source_type: input.sourceType,
    p_source_reference: input.sourceReference?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const discountAmount = parseRpcNumeric(data);
  if (discountAmount <= 0) {
    return { ok: false, error: "No discount was returned for those points." };
  }

  return { ok: true, discountAmount };
}
