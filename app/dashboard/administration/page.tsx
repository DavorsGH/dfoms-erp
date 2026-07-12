import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { ServiceType } from "../service-types";
import ServiceCategories from "./service-categories";

export default async function AdministrationPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("service_types")
    .select("name")
    .order("name", { ascending: true });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <ServiceCategories
        initialCategories={(data as ServiceType[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
