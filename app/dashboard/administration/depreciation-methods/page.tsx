import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { NamedLookup } from "../../lookup-types";
import DepreciationMethods from "../depreciation-methods";

export default async function DepreciationMethodsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("depreciation_methods")
    .select("name")
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Depreciation Methods
      </h2>
      <DepreciationMethods
        initialMethods={(data as NamedLookup[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
