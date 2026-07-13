import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { NamedLookup } from "../../lookup-types";
import FixedAssets from "../fixed-assets";
import type { FixedAssetEntry } from "../fixed-assets-utils";
import FinanceNav from "../finance-nav";

export default async function FixedAssetsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: assetCategories, error: assetCategoriesError },
    { data: depreciationMethods, error: depreciationMethodsError },
  ] = await Promise.all([
    supabase.from("fixed_assets").select("*").order("asset_id", { ascending: true }),
    supabase.from("asset_categories").select("name").order("name", { ascending: true }),
    supabase
      .from("depreciation_methods")
      .select("name")
      .order("name", { ascending: true }),
  ]);

  const fetchError =
    error?.message ??
    assetCategoriesError?.message ??
    depreciationMethodsError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Fixed Assets
      </h2>
      <FixedAssets
        initialAssets={(data as FixedAssetEntry[] | null) ?? []}
        initialAssetCategories={(assetCategories as NamedLookup[] | null) ?? []}
        initialDepreciationMethods={
          (depreciationMethods as NamedLookup[] | null) ?? []
        }
        fetchError={fetchError}
      />
    </div>
  );
}
