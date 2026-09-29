import "server-only";

import { requireAuthenticated } from "@/utils/admin-auth";
import {
  getCurrentUserClientId,
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { readTrustedMiddlewareAuthContext } from "@/utils/trusted-middleware-auth";

export type ClientPortalSession = {
  tenantId: string;
  clientId: string;
  authUserId: string;
};

export async function getClientPortalSession(): Promise<ClientPortalSession | null> {
  const trusted = await readTrustedMiddlewareAuthContext();
  if (
    trusted &&
    trusted.isActive !== false &&
    trusted.role === "client" &&
    trusted.clientId &&
    trusted.tenantId
  ) {
    return {
      tenantId: trusted.tenantId.trim(),
      clientId: trusted.clientId.trim(),
      authUserId: trusted.authUid,
    };
  }

  const auth = await requireAuthenticated();
  if (!auth.ok || !auth.userId) {
    return null;
  }

  const role = await getCurrentUserRole();
  if (role !== "client") {
    return null;
  }

  const [tenantId, clientId] = await Promise.all([
    getCurrentUserTenantId(),
    getCurrentUserClientId(),
  ]);

  if (!tenantId?.trim() || !clientId?.trim()) {
    return null;
  }

  return {
    tenantId: tenantId.trim(),
    clientId: clientId.trim(),
    authUserId: auth.userId,
  };
}
