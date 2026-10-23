import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PortalLoginAccessAction,
  PortalLoginActorPersona,
  PortalLoginTargetPersona,
  PortalLoginVerificationMethod,
} from "./types";

export async function writePortalLoginAccessAudit(
  admin: SupabaseClient,
  row: {
    actorAuthUid: string;
    actorPersona: PortalLoginActorPersona;
    actorTenantId: string | null;
    targetPersona: PortalLoginTargetPersona;
    targetRecordId: string;
    targetAuthUid: string | null;
    action: PortalLoginAccessAction;
    oldEmail: string | null;
    newEmail: string | null;
    verificationMethod: PortalLoginVerificationMethod;
    reason: string;
  },
): Promise<void> {
  const { error } = await admin.from("portal_login_access_audit").insert({
    actor_auth_uid: row.actorAuthUid,
    actor_persona: row.actorPersona,
    actor_tenant_id: row.actorTenantId,
    target_persona: row.targetPersona,
    target_record_id: row.targetRecordId,
    target_auth_uid: row.targetAuthUid,
    action: row.action,
    old_email: row.oldEmail,
    new_email: row.newEmail,
    verification_method: row.verificationMethod,
    reason: row.reason.trim().slice(0, 500),
  });

  if (error) {
    console.error(
      "[portal-login-access-audit] insert failed:",
      error.message,
      row.action,
    );
  }
}
