import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
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
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

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
  const report = await getUserDeleteDependencyReport(admin, auth_uid);
  if (!report) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const validation = await validateUserCanBeDeleted(admin, auth_uid);
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

  const result = await deleteUserAccount(admin, auth_uid);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
