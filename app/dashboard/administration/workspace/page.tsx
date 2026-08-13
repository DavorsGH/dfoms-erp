import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentAuthUser,
  getCurrentUserAccount,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
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
    .select(
      "name, logo_url, signature_url, signature_author_name, signature_author_title, address, phone, email",
    )
    .eq("id", tenantId)
    .maybeSingle();

  let initialPhone = data?.phone ?? null;
  let initialEmail = data?.email ?? null;

  const needsPhonePrefill = !initialPhone?.trim();
  const needsEmailPrefill = !initialEmail?.trim();

  if (needsPhonePrefill || needsEmailPrefill) {
    const [authUser, account] = await Promise.all([
      getCurrentAuthUser(),
      getCurrentUserAccount(),
    ]);

    if (needsEmailPrefill && authUser?.email?.trim()) {
      initialEmail = authUser.email.trim();
    }

    if (needsPhonePrefill && account?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("phone, momo_number")
        .eq("employee_id", account.employee_id)
        .maybeSingle();

      const employeePhone =
        employee?.phone?.trim() || employee?.momo_number?.trim() || "";
      if (employeePhone) {
        initialPhone = employeePhone;
      }
    }
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Workspace Settings
      </h2>
      <WorkspaceSettings
        tenantId={tenantId}
        initialName={data?.name ?? ""}
        initialLogoUrl={data?.logo_url ?? null}
        initialSignatureUrl={data?.signature_url ?? null}
        initialSignatureAuthorName={data?.signature_author_name ?? null}
        initialSignatureAuthorTitle={data?.signature_author_title ?? null}
        initialAddress={data?.address ?? null}
        initialPhone={initialPhone}
        initialEmail={initialEmail}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
