import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import SalaryRates from "../salary-rates";
import type { SalaryRateEntry } from "../salary-rates-utils";

async function loadPositionNames(
  supabase: ReturnType<typeof createClient>,
): Promise<string[]> {
  const attempts = ["position_name", "name"] as const;

  for (const nameColumn of attempts) {
    const { data, error } = await supabase
      .from("positions")
      .select(nameColumn)
      .order(nameColumn, { ascending: true });

    if (error || !data?.length) {
      continue;
    }

    return data
      .map((row) => String((row as Record<string, string>)[nameColumn]))
      .filter(Boolean);
  }

  return [];
}

export default async function SalaryRatesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, positions] = await Promise.all([
    supabase
      .from("salary_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    loadPositionNames(supabase),
  ]);

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
