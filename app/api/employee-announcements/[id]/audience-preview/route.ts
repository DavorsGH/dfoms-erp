import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { previewAnnouncementAudience } from "@/utils/employee-announcement-send";
import { EMPLOYEE_ANNOUNCEMENTS_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(EMPLOYEE_ANNOUNCEMENTS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Announcement id is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  try {
    const preview = await previewAnnouncementAudience(supabase, {
      tenantId: auth.tenantId,
      announcementId: id,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview audience.";
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status)
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
