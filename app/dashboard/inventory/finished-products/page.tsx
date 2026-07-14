import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import FinishedProducts from "../finished-products";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import InventoryShell from "../inventory-shell";

export default async function FinishedProductsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("finished_products")
    .select(FINISHED_PRODUCT_SELECT)
    .order("product_name", { ascending: true });

  return (
    <InventoryShell sectionTitle="Finished Products">
      <FinishedProducts
        initialProducts={
          (data as FinishedProductRecord[] | null)?.map((row) =>
            normalizeFinishedProduct(row),
          ) ?? []
        }
        fetchError={error?.message ?? null}
      />
    </InventoryShell>
  );
}
