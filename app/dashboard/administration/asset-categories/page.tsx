import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import AssetCategories from "../asset-categories";

export default async function AssetCategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("asset_categories")
    .select("name, is_active")
    .order("name", { ascending: true });

  return (
    <>
      <AssetCategories
        initialCategories={
          (data as Array<{ name: string; is_active?: boolean }> | null) ?? []
        }
        fetchError={error?.message ?? null}
      />
    </>
  );
}
