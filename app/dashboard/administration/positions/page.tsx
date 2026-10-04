import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import Positions, { type PositionRow } from "../positions";

export default async function PositionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Manage Positions
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Manage Positions.
        </p>
      </>
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .select("position_title")
    .eq("tenant_id", tenantId)
    .order("position_title", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Manage Positions
      </h2>
      <Positions
        tenantId={tenantId}
        initialPositions={(data as PositionRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
