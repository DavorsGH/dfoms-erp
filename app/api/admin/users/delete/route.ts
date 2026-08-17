import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  deleteUserAccount,
  formatUserDeleteDependencyReport,
  getUserDeleteDependencyReport,
  getUserDeleteBlockMessage,
  validateUserCanBeDeleted,
} from "@/utils/admin-user-delete";
import { createAdminClient } from "@/utils/supabase/admin";

type DeleteUserBody = {
  auth_uid?: string;
};

export async function POST(request: Request) {
  try {
    const auth = await requireTenantSuperAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const { tenantId } = auth;

    let body: DeleteUserBody;
    try {
      body = (await request.json()) as DeleteUserBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { auth_uid } = body;
    if (!auth_uid) {
      return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: account, error: accountError } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("auth_uid", auth_uid)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (accountError) {
      console.error("[admin/users/delete] account lookup failed:", {
        tenantId,
        auth_uid,
        error: accountError.message,
      });
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if (!account) {
      return NextResponse.json({ error: "User account not found" }, { status: 404 });
    }

    const report = await getUserDeleteDependencyReport(admin, auth_uid, tenantId);
    if (!report) {
      return NextResponse.json({ error: "User account not found" }, { status: 404 });
    }

    const validation = await validateUserCanBeDeleted(admin, auth_uid, tenantId);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: getUserDeleteBlockMessage(validation.reason, validation.report),
          dependencies: report,
          dependencySummary: formatUserDeleteDependencyReport(report),
        },
        { status: 400 },
      );
    }

    const result = await deleteUserAccount(admin, auth_uid, tenantId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected delete server error.";
    console.error("[admin/users/delete] unhandled:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
