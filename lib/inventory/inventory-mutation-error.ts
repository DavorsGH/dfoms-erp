import type { PostgrestError } from "@supabase/supabase-js";
import { resolvePostgresRpcErrorMessage } from "@/utils/postgres-fk-violation";

const RAW_POSTGRES_PATTERN =
  /violates (foreign key|unique|check) constraint|update or delete on table|insert or update on table|duplicate key value|row-level security policy/i;

export const INVENTORY_PERMISSION_DENIED_MESSAGE =
  "You don't have permission to save this. Please contact your administrator.";

export function isPostgresRlsViolation(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "42501") {
    return true;
  }
  return (error.message ?? "").toLowerCase().includes("row-level security");
}

export function isRawPostgresErrorMessage(
  message: string | null | undefined,
): boolean {
  if (!message?.trim()) {
    return false;
  }
  return RAW_POSTGRES_PATTERN.test(message);
}

export type MapInventoryMutationErrorOptions = {
  fallbackMessage: string;
  constraintMessages?: Record<string, string>;
};

export function mapInventoryMutationErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
  options: MapInventoryMutationErrorOptions,
): string {
  if (isPostgresRlsViolation(error)) {
    return INVENTORY_PERMISSION_DENIED_MESSAGE;
  }

  const normalized: Pick<PostgrestError, "code" | "message"> | null = error?.message
    ? { code: error.code ?? "", message: error.message }
    : null;

  const mapped = resolvePostgresRpcErrorMessage(normalized, {
    constraintMessages: options.constraintMessages,
    fallbackMessage: options.fallbackMessage,
  });
  if (mapped) {
    return mapped;
  }

  const message = error?.message?.trim();
  if (message && !isRawPostgresErrorMessage(message)) {
    return message;
  }

  return options.fallbackMessage;
}

const INTERNAL_CONSUMPTION_CONSTRAINT_MESSAGES: Record<string, string> = {
  internal_consumption_expense_register_id_fkey:
    "This internal use entry is still linked to its expense row. Refresh the page and try again, or contact support if it keeps failing.",
};

export function mapInternalConsumptionMutationErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  return mapInventoryMutationErrorMessage(error, {
    constraintMessages: INTERNAL_CONSUMPTION_CONSTRAINT_MESSAGES,
    fallbackMessage: "Couldn't save this internal use entry. Please try again.",
  });
}

export function mapInternalConsumptionDeleteErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  return mapInventoryMutationErrorMessage(error, {
    constraintMessages: INTERNAL_CONSUMPTION_CONSTRAINT_MESSAGES,
    fallbackMessage: "Couldn't delete this internal use entry. Please try again.",
  });
}

const STOCK_ADJUSTMENT_CONSTRAINT_MESSAGES: Record<string, string> = {
  finished_product_stock_adjustments_product_id_fkey:
    "That product no longer exists. Choose another product.",
};

export function mapFinishedProductStockAdjustmentErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  return mapInventoryMutationErrorMessage(error, {
    constraintMessages: STOCK_ADJUSTMENT_CONSTRAINT_MESSAGES,
    fallbackMessage: "Couldn't save this stock adjustment. Please try again.",
  });
}

export function mapRawMaterialStockAdjustmentErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  return mapInventoryMutationErrorMessage(error, {
    fallbackMessage: "Couldn't save this stock adjustment. Please try again.",
  });
}
