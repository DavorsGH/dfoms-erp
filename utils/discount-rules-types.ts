import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { roundMoney, toNumber } from "@/utils/client-invoices-types";

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_APPLIES_TO = ["product_sale", "invoice", "both"] as const;
export type DiscountAppliesTo = (typeof DISCOUNT_APPLIES_TO)[number];

export const DISCOUNT_RULE_LIST_SELECT =
  "id, tenant_id, code, name, discount_type, discount_value, applies_to, min_order_amount, start_date, end_date, usage_limit, usage_count, per_customer_limit, is_active" as const;

export const DISCOUNT_RULE_FORM_SELECT =
  "id, tenant_id, code, name, discount_type, discount_value, applies_to, min_order_amount, start_date, end_date, usage_limit, usage_count, per_customer_limit, is_active, created_at, updated_at" as const;

export type DiscountRuleListRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  applies_to: DiscountAppliesTo;
  min_order_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  usage_limit: number | null;
  usage_count: number;
  per_customer_limit: number | null;
  is_active: boolean;
};

export type DiscountRuleFormState = {
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  applies_to: DiscountAppliesTo;
  min_order_amount: string;
  start_date: string;
  end_date: string;
  usage_limit: string;
  per_customer_limit: string;
  is_active: boolean;
};

export type PromoCodePickerRow = {
  code: string;
  name: string;
  applies_to: DiscountAppliesTo;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
};

export function formatDiscountMoney(value: unknown) {
  return formatGHS(toNumber(value));
}

export function formatDiscountType(type: string | null | undefined) {
  return type === "fixed" ? "Fixed amount" : "Percentage";
}

export function formatDiscountAppliesTo(value: string | null | undefined) {
  switch (value) {
    case "product_sale":
      return "Product Sale";
    case "invoice":
      return "Invoice";
    case "both":
      return "Both";
    default:
      return value ?? "—";
  }
}

export function formatDiscountValue(row: Pick<DiscountRuleListRow, "discount_type" | "discount_value">) {
  if (row.discount_type === "percentage") {
    return `${toNumber(row.discount_value)}%`;
  }
  return formatDiscountMoney(row.discount_value);
}

export function formatDiscountDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  const startLabel = start ? formatDiscountDate(start) : "—";
  const endLabel = end ? formatDiscountDate(end) : "—";
  return `${startLabel} → ${endLabel}`;
}

export function formatDiscountDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDiscountUsage(
  row: Pick<DiscountRuleListRow, "usage_count" | "usage_limit">,
) {
  const used = toNumber(row.usage_count);
  const limit = row.usage_limit == null ? null : toNumber(row.usage_limit);
  if (limit == null || limit <= 0) {
    return `${used} used`;
  }
  return `${used} / ${limit}`;
}

export function discountRuleActiveBadgeClassName(isActive: boolean) {
  return isActive ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700";
}

export function normalizeDiscountRuleRow(row: DiscountRuleListRow): DiscountRuleListRow {
  return {
    ...row,
    discount_value: toNumber(row.discount_value),
    min_order_amount:
      row.min_order_amount == null ? null : toNumber(row.min_order_amount),
    usage_limit: row.usage_limit == null ? null : toNumber(row.usage_limit),
    usage_count: toNumber(row.usage_count),
    per_customer_limit:
      row.per_customer_limit == null ? null : toNumber(row.per_customer_limit),
    start_date: row.start_date?.slice(0, 10) ?? null,
    end_date: row.end_date?.slice(0, 10) ?? null,
  };
}

export function emptyDiscountRuleForm(): DiscountRuleFormState {
  return {
    code: "",
    name: "",
    discount_type: "percentage",
    discount_value: 0,
    applies_to: "both",
    min_order_amount: "",
    start_date: "",
    end_date: "",
    usage_limit: "",
    per_customer_limit: "",
    is_active: true,
  };
}

export function discountRuleToFormState(row: DiscountRuleListRow): DiscountRuleFormState {
  return {
    code: row.code,
    name: row.name,
    discount_type: row.discount_type,
    discount_value: toNumber(row.discount_value),
    applies_to: row.applies_to,
    min_order_amount:
      row.min_order_amount == null ? "" : String(row.min_order_amount),
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    usage_limit: row.usage_limit == null ? "" : String(row.usage_limit),
    per_customer_limit:
      row.per_customer_limit == null ? "" : String(row.per_customer_limit),
    is_active: row.is_active,
  };
}

export function parseOptionalDiscountNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDiscountRulePayload(form: DiscountRuleFormState) {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    discount_type: form.discount_type,
    discount_value: roundMoney(toNumber(form.discount_value)),
    applies_to: form.applies_to,
    min_order_amount: parseOptionalDiscountNumber(form.min_order_amount),
    start_date: form.start_date.trim() || null,
    end_date: form.end_date.trim() || null,
    usage_limit: parseOptionalDiscountNumber(form.usage_limit),
    per_customer_limit: parseOptionalDiscountNumber(form.per_customer_limit),
    is_active: form.is_active,
  };
}
