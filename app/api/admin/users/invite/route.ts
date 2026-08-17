import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { createAndSendStaffPortalInvite } from "@/utils/staff-portal-invite";

type InviteUserBody = {
  employee_id?: string | null;
  email?: string;
  role?: string;
  client_id?: string | null;
  supervisor_site_codes?: string[];
};

export async function POST(request: Request) {
  try {
    const auth = await requireTenantSuperAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    let body: InviteUserBody;
    try {
      body = (await request.json()) as InviteUserBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { email, role, employee_id, client_id, supervisor_site_codes } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: "email and role are required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const result = await createAndSendStaffPortalInvite(admin, {
      tenantId: auth.tenantId,
      email,
      role,
      employee_id,
      client_id,
      supervisor_site_codes,
      invitedBy: user?.id ?? null,
    });

    if (!result.ok) {
      console.error("[admin/users/invite] failed:", {
        tenantId: auth.tenantId,
        email,
        role,
        client_id,
        status: result.status ?? 400,
        error: result.error,
      });
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }

    return NextResponse.json({
      invite_id: result.invite_id,
      message: "Invite email sent.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected invite server error.";
    console.error("[admin/users/invite] unhandled:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
