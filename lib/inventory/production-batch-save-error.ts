import type { PostgrestError } from "@supabase/supabase-js";
import {
  extractPostgresUniqueConstraintName,
  resolvePostgresRpcErrorMessage,
} from "@/utils/postgres-fk-violation";

const PRODUCTION_BATCH_SAVE_CONSTRAINT_MESSAGES: Record<string, string> = {
  production_batch_materials_batch_material_key:
    "Each raw material can only appear once on a batch. Combine the quantities into one line.",
};

export function mapProductionBatchSaveErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  const normalized: Pick<PostgrestError, "code" | "message"> | null =
    error?.message
      ? {
          code: error.code ?? "",
          message: error.message,
        }
      : null;
  const mapped = resolvePostgresRpcErrorMessage(normalized, {
    constraintMessages: PRODUCTION_BATCH_SAVE_CONSTRAINT_MESSAGES,
    fallbackMessage: "Couldn't save the production batch. Please try again.",
  });

  if (mapped) {
    return mapped;
  }

  const constraint = extractPostgresUniqueConstraintName(error?.message);
  if (
    constraint === "production_batch_materials_batch_material_key" ||
    (error?.message ?? "").includes(
      "production_batch_materials_batch_material_key",
    )
  ) {
    return PRODUCTION_BATCH_SAVE_CONSTRAINT_MESSAGES.production_batch_materials_batch_material_key;
  }

  return "Couldn't save the production batch. Please try again.";
}
