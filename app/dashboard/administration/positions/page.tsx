import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import Positions, { type PositionRow } from "../positions";

export default async function PositionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("positions")
    .select("position_title")
    .order("position_title", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Manage Positions
      </h2>
      <Positions
        initialPositions={(data as PositionRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
