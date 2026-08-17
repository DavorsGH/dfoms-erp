import { createAdminClient } from "@/utils/supabase/admin";
import type { PortalKind } from "@/lib/middleware-auth-context";

/** Persist portal persona on the auth user so middleware can skip DB persona probes. */
export async function syncAuthUserPortalMetadata(
  authUid: string,
  portal: PortalKind,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(authUid);
  if (error || !data.user) {
    return;
  }

  const existing = data.user.user_metadata?.portal;
  if (existing === portal) {
    return;
  }

  await admin.auth.admin.updateUserById(authUid, {
    user_metadata: {
      ...data.user.user_metadata,
      portal,
    },
  });
}

/** Infer and sync portal metadata after staff ERP login. */
export async function syncStaffPortalMetadataAfterLogin(
  authUid: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (account) {
    await syncAuthUserPortalMetadata(authUid, "staff");
  }
}
