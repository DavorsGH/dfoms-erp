import type { SupabaseClient } from "@supabase/supabase-js";
import { isPostgresUniqueViolation } from "@/utils/postgres-fk-violation";

export function normalizeProductBarcodeInput(value: string): string {
  return value.trim();
}

export function finishedProductBarcodeFieldError(message: string): string {
  return message;
}

export async function findFinishedProductIdByBarcode(
  supabase: SupabaseClient,
  barcode: string,
  excludeProductId?: string | null,
): Promise<{ productId: string | null; error: string | null }> {
  const normalized = normalizeProductBarcodeInput(barcode);
  if (!normalized) {
    return { productId: null, error: null };
  }

  let query = supabase
    .from("finished_products")
    .select("id")
    .eq("barcode", normalized)
    .limit(1);

  if (excludeProductId) {
    query = query.neq("id", excludeProductId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { productId: null, error: error.message };
  }

  return { productId: data?.id ?? null, error: null };
}

export function mapFinishedProductBarcodeSaveError(
  error: { code: string; message: string } | null,
): string | null {
  if (!error) {
    return null;
  }
  if (!isPostgresUniqueViolation(error)) {
    return null;
  }

  const constraint = (error.message ?? "").toLowerCase();
  if (constraint.includes("barcode")) {
    return "This barcode is already used by another product in your workspace.";
  }

  return "This barcode is already in use.";
}
