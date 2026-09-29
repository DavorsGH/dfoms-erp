import "server-only";

import { requireAuthenticated } from "@/utils/admin-auth";
import {
  getCurrentUserClientId,
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import type { MiddlewareAuthLoadOptions } from "@/lib/middleware-trust-policy";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import { readTrustedMiddlewareAuthContext } from "@/utils/trusted-middleware-auth";

export type ClientPortalSession = {
  tenantId: string;
  clientId: string;
  authUserId: string;
};

export async function getClientPortalSession(
  options?: MiddlewareAuthLoadOptions,
): Promise<ClientPortalSession | null> {
  if (!options?.skipMiddlewareTrust) {
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
  }

  const auth = await requireAuthenticated();
  if (!auth.ok || !auth.userId) {
    return null;
  }

  const authOpts = options?.skipMiddlewareTrust
    ? ROUTE_HANDLER_AUTH_OPTS
    : options;
  const role = await getCurrentUserRole(authOpts);
  if (role !== "client") {
    return null;
  }

  const [tenantId, clientId] = await Promise.all([
    getCurrentUserTenantId(authOpts),
    getCurrentUserClientId(authOpts),
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
