import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { verifyAuthContext, isMiddlewareContextSigningConfigured } from "@/lib/middleware-auth-context";
import { createClient } from "@/utils/supabase/server";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

/**
 * Staging/local regression helper — compares signed middleware context vs live DB.
 * Only available when DFOMS_PERF_PROBE=true.
 */
export async function GET() {
  if (!isPerfProbeEnabled()) {
    return NextResponse.json({ error: "Disabled" }, { status: 404 });
  }

  const headerStore = await headers();
  const trusted = await verifyAuthContext(
    headerStore.get("x-dfoms-auth-context"),
  );

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const { data: liveRow } = await supabase
    .from("user_accounts")
    .select("tenant_id, role, is_active")
    .eq("auth_uid", user.id)
    .maybeSingle();

  return NextResponse.json({
    authenticated: true,
    signingConfigured: isMiddlewareContextSigningConfigured(),
    hasContextHeader: Boolean(headerStore.get("x-dfoms-auth-context")),
    trustedContext: trusted
      ? {
          tenantId: trusted.tenantId,
          role: trusted.role,
          isActive: trusted.isActive,
          portal: trusted.portal,
        }
      : null,
    liveDbRow: liveRow ?? null,
    tenantIdMatches:
      trusted?.tenantId != null &&
      liveRow?.tenant_id != null &&
      trusted.tenantId === liveRow.tenant_id,
  });
}
