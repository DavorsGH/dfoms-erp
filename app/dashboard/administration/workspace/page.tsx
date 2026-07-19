import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import WorkspaceSettings from "../workspace-settings";

export default async function WorkspaceSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Workspace Settings
        </h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </>
    );
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("name, logo_url")
    .eq("id", tenantId)
    .maybeSingle();

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Workspace Settings
      </h2>
      <WorkspaceSettings
        tenantId={tenantId}
        initialName={data?.name ?? ""}
        initialLogoUrl={data?.logo_url ?? null}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
