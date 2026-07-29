import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";

export const TIER_FEATURE_KEYS = [
  "operations",
  "crm_core",
  "pos",
  "inventory",
  "email_promotions",
] as const;

export type TierFeatureKey = (typeof TIER_FEATURE_KEYS)[number];

export const TIER_FEATURE_LABELS: Record<TierFeatureKey, string> = {
  operations: "Operations",
  crm_core: "Sales & CRM",
  pos: "POS",
  inventory: "Inventory",
  email_promotions: "Email & Promotions",
};

/** Minimum plan that unlocks each feature (display copy only). */
export const TIER_FEATURE_MIN_PLAN: Record<TierFeatureKey, string> = {
  operations: "Professional",
  crm_core: "Professional",
  pos: "Business",
  inventory: "Business",
  email_promotions: "Enterprise",
};

export function isTierFeatureKey(value: string): value is TierFeatureKey {
  return (TIER_FEATURE_KEYS as readonly string[]).includes(value);
}

export const tenantHasFeature = cache(
  async (tenantId: string, featureKey: string): Promise<boolean> => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("tenant_has_feature", {
      p_tenant_id: tenantId,
      p_feature_key: featureKey,
    });

    if (error) {
      throw error;
    }

    return data === true;
  },
);

/**
 * Blocks dashboard section access when the tenant's plan does not include
 * featureKey. Redirects to the in-shell upgrade page.
 *
 * Fail-closed: missing tenant_id redirects to login (previously allowed through).
 */
export async function requireFeatureAccess(featureKey: string): Promise<void> {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    redirect("/login");
  }

  const allowed = await tenantHasFeature(tenantId, featureKey);
  if (!allowed) {
    redirect(
      `/dashboard/upgrade-required?feature=${encodeURIComponent(featureKey)}`,
    );
  }
}

/**
 * API-route equivalent of requireFeatureAccess. Fail-closed on null tenant.
 * Call after role auth; returns 403 JSON when the plan lacks the feature.
 */
export async function assertTenantHasFeature(
  tenantId: string | null | undefined,
  featureKey: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!tenantId?.trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const allowed = await tenantHasFeature(tenantId, featureKey);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "This feature requires a plan upgrade.",
          feature: featureKey,
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}
