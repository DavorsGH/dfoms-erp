import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import InventoryShell from "../inventory-shell";
import ProductionBatches from "../production-batches";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import {
  normalizeProductionBatch,
  PRODUCTION_BATCH_DETAIL_SELECT,
  type ProductionBatchRecord,
} from "../production-batches-utils";
import {
  normalizeRawMaterial,
  RAW_MATERIAL_SELECT,
  type RawMaterialRecord,
} from "../raw-materials-utils";

export default async function ProductionBatchesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: batches, error: batchesError },
    { data: products, error: productsError },
    { data: materials, error: materialsError },
  ] = await Promise.all([
    supabase
      .from("production_batches")
      .select(PRODUCTION_BATCH_DETAIL_SELECT)
      .order("production_date", { ascending: false }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
  ]);

  const fetchError =
    batchesError?.message ??
    productsError?.message ??
    materialsError?.message ??
    null;

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Production Batches">
      <ProductionBatches
        initialBatches={
          (batches as ProductionBatchRecord[] | null)?.map((row) =>
            normalizeProductionBatch(row),
          ) ?? []
        }
        initialProducts={
          (products as FinishedProductRecord[] | null)?.map((row) =>
            normalizeFinishedProduct(row),
          ) ?? []
        }
        initialMaterials={
          (materials as RawMaterialRecord[] | null)?.map((row) =>
            normalizeRawMaterial(row),
          ) ?? []
        }
        fetchError={fetchError}
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
