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
  try {
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

    const { data: account, error: accountError } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("auth_uid", authUid)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (accountError) {
      console.error("[admin/users/delete-dependencies] account lookup failed:", {
        tenantId,
        authUid,
        error: accountError.message,
      });
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected delete-dependencies server error.";
    console.error("[admin/users/delete-dependencies] unhandled:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
