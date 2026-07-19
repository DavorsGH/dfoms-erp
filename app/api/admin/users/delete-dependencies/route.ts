import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  formatUserDeleteDependencyReport,
  getUserDeleteDependencyReport,
  getUserDeleteBlockMessage,
  validateUserCanBeDeleted,
} from "@/utils/admin-user-delete";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  const authUid = new URL(request.url).searchParams.get("auth_uid");
  if (!authUid) {
    return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const report = await getUserDeleteDependencyReport(admin, authUid, tenantId);

  if (!report) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const validation = await validateUserCanBeDeleted(admin, authUid, tenantId);

  return NextResponse.json({
    report,
    summary: formatUserDeleteDependencyReport(report),
    canDelete: validation.ok,
    blockReason: validation.ok ? null : validation.reason,
    blockMessage: validation.ok
      ? null
      : getUserDeleteBlockMessage(validation.reason, validation.report),
  });
}
