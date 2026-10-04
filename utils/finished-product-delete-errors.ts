import type { PostgrestError } from "@supabase/supabase-js";
import {
  extractPostgresForeignKeyConstraintName,
  isPostgresForeignKeyViolation,
  resolveDeleteErrorMessage,
} from "@/utils/postgres-fk-violation";

export const FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE =
  "This product has purchase or sale history and can't be deleted. Deactivate it instead so it stops appearing for new transactions.";

const FINISHED_PRODUCT_PURCHASE_FK_CONSTRAINTS = new Set([
  "product_purchases_product_id_fkey",
]);

export function isFinishedProductDeleteForeignKeyError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error || !isPostgresForeignKeyViolation(error)) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("finished_products") ||
    FINISHED_PRODUCT_PURCHASE_FK_CONSTRAINTS.has(
      extractPostgresForeignKeyConstraintName(error.message) ?? "",
    ) ||
    message.includes("product_purchases")
  );
}

export function getFinishedProductDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  return resolveDeleteErrorMessage(error, {
    constraintMessages: {
      product_purchases_product_id_fkey: FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE,
    },
    fallbackInUseMessage: FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE,
    fallbackNonFkMessage: "Unable to delete this finished product. Try again.",
  });
}
