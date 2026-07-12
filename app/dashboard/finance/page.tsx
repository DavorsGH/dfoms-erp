import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { ServiceType } from "../service-types";
import IncomeRegister from "./income-register";
import type { IncomeRegisterEntry } from "./income-register-utils";

export default async function FinancePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: serviceTypes, error: serviceTypesError }] =
    await Promise.all([
      supabase.from("income_register").select("*").order("date", { ascending: false }),
      supabase.from("service_types").select("name").order("name", { ascending: true }),
    ]);

  const fetchError = error?.message ?? serviceTypesError?.message ?? null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Income Register
      </h1>
      <IncomeRegister
        initialEntries={(data as IncomeRegisterEntry[] | null) ?? []}
        initialServiceTypes={(serviceTypes as ServiceType[] | null) ?? []}
        fetchError={fetchError}
      />
    </div>
  );
}
