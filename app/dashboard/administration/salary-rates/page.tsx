import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchPositions } from "../../employees/lookup-utils";
import SalaryRates from "../salary-rates";
import type { SalaryRateEntry } from "../salary-rates-utils";

export default async function SalaryRatesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, positionLookups] = await Promise.all([
    supabase
      .from("salary_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    fetchPositions(supabase),
  ]);

  const positions = positionLookups.map((position) => position.name);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Salary Rates</h2>
      <SalaryRates
        initialRates={(data as SalaryRateEntry[] | null) ?? []}
        initialPositions={positions}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
