import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import OperationsShell from "../operations-shell";
import ConsumablesStoreNav from "../consumables-store-nav";

export default async function ConsumablesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  let showLegacyTab = false;
  if (tenantId) {
    const { count } = await supabase
      .from("consumables")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    showLegacyTab = (count ?? 0) > 0;
  }

  return (
    <OperationsShell sectionTitle="Consumables">
      <ConsumablesStoreNav showLegacyTab={showLegacyTab} />
      {children}
    </OperationsShell>
  );
}
