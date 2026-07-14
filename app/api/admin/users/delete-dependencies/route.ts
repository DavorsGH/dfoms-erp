import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
import {
  formatUserDeleteDependencyReport,
  getUserDeleteDependencyReport,
  getUserDeleteBlockMessage,
  validateUserCanBeDeleted,
} from "@/utils/admin-user-delete";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const authUid = new URL(request.url).searchParams.get("auth_uid");
  if (!authUid) {
    return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const report = await getUserDeleteDependencyReport(admin, authUid);

  if (!report) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const validation = await validateUserCanBeDeleted(admin, authUid);

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
