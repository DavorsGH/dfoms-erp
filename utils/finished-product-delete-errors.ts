import type { PostgrestError } from "@supabase/supabase-js";

export const FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE =
  "This product has purchase or sale history and can't be deleted. Deactivate it instead so it stops appearing for new transactions.";

const FINISHED_PRODUCT_PURCHASE_FK_CONSTRAINTS = new Set([
  "product_purchases_product_id_fkey",
]);

export function isFinishedProductDeleteForeignKeyError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23503") {
    const message = (error.message ?? "").toLowerCase();
    return (
      message.includes("finished_products") ||
      FINISHED_PRODUCT_PURCHASE_FK_CONSTRAINTS.has(
        extractForeignKeyConstraintName(error.message) ?? "",
      ) ||
      message.includes("product_purchases")
    );
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("violates foreign key constraint") &&
    (message.includes("finished_products") || message.includes("product_purchases"))
  );
}

function extractForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(/violates foreign key constraint "([^"]+)"/i);
  return match?.[1] ?? null;
}

export function getFinishedProductDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  if (!error?.message) {
    return "Unable to delete this finished product. Try again.";
  }

  if (isFinishedProductDeleteForeignKeyError(error)) {
    return FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE;
  }

  return error.message;
}
