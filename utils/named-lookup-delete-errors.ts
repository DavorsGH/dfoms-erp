import type { PostgrestError } from "@supabase/supabase-js";
import { getLookupDeleteInUseMessage } from "@/utils/position-delete-errors";
import { resolveDeleteErrorMessage } from "@/utils/postgres-fk-violation";

export function getNamedLookupDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  entityLabel: string,
): string {
  return resolveDeleteErrorMessage(error, {
    fallbackInUseMessage: getLookupDeleteInUseMessage(entityLabel),
    fallbackNonFkMessage: `Unable to delete this ${entityLabel.toLowerCase()}. Try again.`,
  });
}
